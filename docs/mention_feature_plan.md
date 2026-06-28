# 群聊 @mention 功能设计方案

> 参照微信，在群聊中支持 `@` 快捷选择群成员，被 @ 的人收到特殊气泡提示。

---

## 1. 功能概述

### 1.1 微信 @mention 行为分析

| 场景 | 微信行为 |
|------|---------|
| 输入 `@` | 弹出群成员列表，用户可上下键 + 回车 / 鼠标点击选择 |
| 输入 `@关键词` | 实时过滤群成员列表，匹配昵称/工号 |
| **一条消息 @ 多人** | 支持在一条消息中多次输入 `@`，每次弹出选择器；选择后光标停留在 `@昵称 ` 之后，可继续输入文字或再次 `@`。最终 `mention_ids` 数组包含所有被 @ 者的 UUID |
| **@ 前后附带文本** | 支持 `@张三 你好，请查收` 或 `请 @张三 查收` 或 `@张三 @李四 开会了` 等混合格式；文本中非 @ 部分作为普通消息内容保留 |
| `@所有人` | **所有人可用**（不限群主/管理员），选择后消息有 `@所有人` 前缀；`mention_ids` 中包含特殊标记 `"ALL"`，所有群成员在自己窗口都看到特殊气泡 |
| 发送后 | 消息内容保留 `@昵称` / `@所有人` 文本，被 @ 者收到特殊提醒 |
| 被 @ 的消息气泡 | **被 @ 的用户在自己的聊天窗口里，该消息气泡背景变为蓝色高亮**（区别于普通群聊消息），类似"有人提到你" |
| 通知 | 被 @ 的人如果窗口未聚焦，收到系统通知时附加 `[有人@我]` |
| 群列表摘要 | 如果最后一条消息 @ 了自己，群列表摘要前缀 `[有人@我]` |

### 1.2 本方案实现范围（Phase 1 — 全部实现）

- ✅ 群聊输入框按 `@` 弹出成员选择器
- ✅ 支持 `@关键词` 实时过滤
- ✅ **一条消息 @ 多个成员**：可多次触发 @ 选择器，`mention_ids` 数组收集所有被 @ 者
- ✅ **@ 前后附带普通文本**：`@张三 你好` / `请 @张三 查收` / `@张三 @李四 开会了` 等混合格式均支持
- ✅ 键盘上下键 + Enter / 鼠标点击选择
- ✅ **`@所有人` 快捷选项**（选择器列表顶部固定项，**不限权限，全员可用**）
- ✅ 消息体携带 `mention_ids` 数组（被 @ 的用户 UUID 列表；`@所有人` 时数组为 `["ALL"]`）
- ✅ 被 @ 者在自己窗口看到特殊蓝色高亮气泡（"有人@我" 提示条）
- ✅ 消息文本中 `@昵称` / `@所有人` 以蓝色高亮渲染
- ✅ 系统通知区分（被 @ 时标题附加 `[有人@我]`）
- ✅ 群列表摘要区分（被 @ 时前缀 `[有人@我]`）

---

## 2. 数据模型变更

### 2.1 `messages` 表新增字段

| 数据库 | 字段 | 类型 | 说明 |
|--------|------|------|------|
| Supabase (PostgreSQL) | `mention_ids` | `TEXT[]`（PostgreSQL 数组） | 被 @ 的用户 UUID 列表；`@所有人` 时为 `{ALL}`；非群聊时为 NULL |
| Go 后端 (MySQL) | `mention_ids` | `TEXT`（JSON 字符串） | 被 @ 的用户 UUID 列表；`@所有人` 时为 `["ALL"]`；非群聊时为 NULL |

### 2.2 TypeScript 类型变更

```ts
// src/types/index.ts

/** 特殊标记：代表 @所有人 */
export const MENTION_ALL = 'ALL'

export interface Message {
  // ... 现有字段
  /** 被 @ 的用户 ID 列表（仅群聊）；含 "ALL" 表示 @所有人 */
  mention_ids?: string[]
}

export interface SendMessageParams {
  // ... 现有字段
  /** 被 @ 的用户 ID 列表（仅群聊）；含 "ALL" 表示 @所有人 */
  mention_ids?: string[]
}
```

### 2.3 Go 后端 Model 变更

```go
// go-chat-server/model/message.go
type Message struct {
  // ... 现有字段
  MentionIDs string `json:"mention_ids,omitempty" gorm:"type:text;comment:被@的用户ID列表(JSON数组)"`
}
```

---

## 3. 前端实现方案

### 3.1 组件关系图

```
InputArea.vue
  ├── 文本输入框（监听 @ 输入）
  └── MentionSelector.vue  ← 新增，弹层浮在输入框上方
        ├── 成员列表项（头像 + 昵称）
        └── 键盘导航（上下键 + Enter + Escape）
```

### 3.2 InputArea.vue 改动

#### 3.2.1 状态机

```ts
enum MentionState {
  IDLE,           // 正常输入
  ACTIVE,         // 弹出选择器，正在过滤/选择
}
```

#### 3.2.2 @ 触发逻辑

```
用户在群聊输入框中输入 "@" 字符 →
  1. 记录 cursor 位置（@ 符号的起始位置）
  2. 从 store 获取当前群成员列表（优先使用缓存，缓存未命中则 fetchGroupMembers）
  3. 弹出 MentionSelector，显示所有成员 + @所有人
  4. 用户继续输入 → 实时过滤成员列表（@所有人 始终可见）
  5. 选择成员（Enter/Click）→ 替换 @keyword 为 @昵称 + 空格，关闭选择器
  6. 选择后光标停在 @昵称 之后，可继续输入普通文本或再次输入 @ 触发选择器
  7. Escape → 关闭选择器，保留已输入的文本（包括未完成的 @xxx）
```

**多 @ 与混合文本示例**：

| 输入过程 | 最终输入框内容 | `mention_ids` 结果 |
|----------|---------------|-------------------|
| `@` → 选张三 → ` ` → 输入 `你好` | `@张三 你好` | `[张三_UUID]` |
| `请 ` → `@` → 选张三 → ` ` → `查收` | `请 @张三 查收` | `[张三_UUID]` |
| `@` → 选张三 → ` ` → `@` → 选李四 → ` ` → `开会` | `@张三 @李四 开会` | `[张三_UUID, 李四_UUID]` |
| `@` → 选所有人 → ` ` → `大家好` | `@所有人 大家好` | `["ALL"]` |
| `@` → 选所有人 → ` ` → `@` → 选张三 | `@所有人 @张三 请回复` | `["ALL", 张三_UUID]` |

#### 3.2.3 输入框实现方式

使用 `contenteditable` div 或继续使用原生 `<input>` + 浮层：

**方案选择**：继续使用原生 `<input>`，理由：
- 微信 Desktop 也是 input + 浮层
- 无需引入 contenteditable 复杂度
- @mention 信息通过 `mention_ids` 数组传递，文本中 `@昵称` 仅用于展示

#### 3.2.4 发送消息时提取 mention_ids

`extractMentions` 函数负责从整段文本中解析所有 @ 提及。核心设计：

- **支持多 @**：正则 `/@(\S+)/g` 使用 `g` 标志 + `while` 循环，自动匹配全文所有 `@xxx` 出现位置
- **支持混合文本**：正则仅提取 `@xxx` 部分，文本中的普通内容不影响解析
- **@所有人 优先**：先检查 `@所有人` 文本，插入 `"ALL"` 特殊标记
- **去重**：同一成员多次 @ 只保留一个 ID

```ts
// InputArea.vue sendTextMessage() 中
import { MENTION_ALL } from '../../types'

function extractMentions(text: string, members: GroupMember[]): string[] {
  const mentionIds: string[] = []

  // 先检查 @所有人（支持混合文本：如 "大家好 @所有人 请注意"）
  if (/@所有人\b/.test(text)) {
    mentionIds.push(MENTION_ALL)
  }

  // 提取所有 @具体成员（/g 标志匹配全文中的所有 @xxx 出现位置）
  const mentionRegex = /@(\S+)/g
  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1]
    if (name === '所有人') continue // 已处理
    const member = members.find(m => m.nickname === name)
    if (member && !mentionIds.includes(member.user_id)) {
      mentionIds.push(member.user_id)
    }
  }
  return mentionIds
}
```

### 3.3 MentionSelector.vue 组件

#### 3.3.1 Props & Emits

```ts
interface Props {
  visible: boolean
  /** 过滤关键词（@ 后面输入的文本） */
  keyword: string
  /** 群成员列表 */
  members: GroupMember[]
  /** 定位坐标（基于 input 计算） */
  position: { top: number; left: number }
}

interface Emits {
  (e: 'select', member: GroupMember | '@all'): void
  (e: 'close'): void
}
```

#### 3.3.2 UI 设计

- 绝对定位于输入框上方（`position: absolute; bottom: 100%`）
- 最大高度 260px，超出滚动
- **顶部固定项：`@所有人`**（蓝色喇叭图标 + "所有人" 文字，始终显示，不受过滤影响）
- 分隔线后是成员列表：头像 + 昵称 + 工号（可选）
- 键盘选中项高亮（`bg-blue-500/20`）
- 暗黑风格匹配现有主题

#### 3.3.3 过滤逻辑

- `@所有人` 项始终显示在列表顶部
- 成员列表根据 `keyword` 过滤昵称/工号
- 关键词为空时显示全部成员（排除自己）
- 如果用户输入了关键词且匹配到了成员，`@所有人` 仍然可见

#### 3.3.4 键盘导航

| 按键 | 行为 |
|------|------|
| `↑` | 上移选中项 |
| `↓` | 下移选中项 |
| `Enter` | 选择当前高亮项（成员 或 `@所有人`） |
| `Escape` | 关闭选择器 |

### 3.4 ChatWindow.vue 改动 — 消息气泡渲染

#### 3.4.1 判断是否 @ 了自己

```ts
import { MENTION_ALL } from '../../types'

function isMentionedMe(msg: Message): boolean {
  if (!msg.mention_ids || msg.mention_ids.length === 0) return false
  // @所有人：所有群成员都视为被提及
  if (msg.mention_ids.includes(MENTION_ALL)) return true
  // 精确匹配
  return msg.mention_ids.includes(authStore.currentUser?.id ?? '')
}
```

#### 3.4.2 被 @ 消息的特殊气泡

```html
<!-- 判断：被 @ 了（mention_ids 含自己或 ALL） -->
<div
  v-if="isMentionedMe(msg)"
  class="mention-badge"
>
  <svg><!-- @图标 --></svg>
  <span>有人@我</span>
</div>
```

#### 3.4.3 气泡样式区分

| 条件 | 气泡样式 |
|------|---------|
| 普通群聊消息（自己的） | 蓝绿渐变（现有） |
| 普通群聊消息（他人的） | 灰色背景（现有） |
| **@ 自己的消息 / @所有人（他人发的）** | **蓝色边框 + 蓝色半透明背景 + "有人@我" 标签** |
| @ 别人的消息（自己发的） | 蓝绿渐变（不变） |
| **@所有人（自己发的）** | **蓝绿渐变 + @蓝色标签**（自己是发送者，不标记"有人@我"） |

#### 3.4.4 文本内 @昵称 / @所有人 高亮

对 `msg.msg_type === 'text'` 的消息，渲染时将 `@昵称` 和 `@所有人` 替换为蓝色高亮 span：

```ts
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
}

function renderMentionText(content: string): string {
  const escaped = escapeHtml(content)
  // 匹配 @所有人 或 @xxx（非空白连续字符）
  return escaped.replace(/@(所有人|\S+)/g, '<span class="text-blue-400 font-medium">@$1</span>')
}
```

注意：需要使用 `v-html`，消息内容必须先做 HTML 转义再替换 @ 防止 XSS。

### 3.5 Store 层改动（chat.ts）

#### 3.5.1 sendMessage 修改

```ts
async function sendMessage(content: string, msgType = 'text', mentionIds?: string[]) {
  // ...
  if (activeGroup.value && mentionIds && mentionIds.length > 0) {
    msgData.mention_ids = mentionIds
  }
  // ...
}
```

#### 3.5.2 实时通知增强

```ts
import { MENTION_ALL } from '../types'

// sendSystemNotification 中
function isMsgMentioningMe(msg: Message, myId: string): boolean {
  if (!msg.mention_ids || msg.mention_ids.length === 0) return false
  return msg.mention_ids.includes(MENTION_ALL) || msg.mention_ids.includes(myId)
}

if (isMsgMentioningMe(msg, authStore.currentUser!.id)) {
  title = `[有人@我] ${title}`
}
```

#### 3.5.3 群列表摘要增强

```ts
// initRealtimeListener 中更新群消息摘要时
if (isMsgMentioningMe(newMsg, authStore.currentUser!.id)) {
  g.last_message = '[有人@我] ' + (newMsg.content ?? '')
}
```

---

## 4. Service 层改动

### 4.1 Supabase (chatService.ts)

```ts
async sendMessage(msgData: SendMessageParams): Promise<Message> {
  const insertPayload: Record<string, unknown> = { /* ... */ }
  if (msgData.mention_ids && msgData.mention_ids.length > 0) {
    insertPayload.mention_ids = msgData.mention_ids
  }
  // ...
}
```

- Supabase PostgreSQL 原生支持 `TEXT[]` 数组类型，直接传入 JS 数组即可

### 4.2 Go 后端 (goChatService.ts)

```ts
// WebSocket 发送时
this.ws.send(JSON.stringify({
  type: 'chat',
  // ...
  mention_ids: msgData.mention_ids,
}))

// HTTP 退化发送时
body: JSON.stringify({ ...msgData })
```

---

## 5. 数据库迁移

### 5.1 Supabase (PostgreSQL) 脚本

```sql
-- supabase-sql/10_add_mention_ids.sql

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mention_ids TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.messages.mention_ids
  IS '被@的用户ID数组，仅群聊消息使用';
```

### 5.2 MySQL (Go 后端)

使用 GORM AutoMigrate，在 [`go-chat-server/model/message.go`](go-chat-server/model/message.go) 中增加 `MentionIDs` 字段后，启动时自动追加列。

---

## 6. 实现步骤（执行顺序）

| 序号 | 步骤 | 涉及文件 | 预计行数 |
|------|------|---------|---------|
| 1 | 数据库迁移：messages 表增加 `mention_ids` 列 | `supabase-sql/10_add_mention_ids.sql` | ~6 行 |
| 2 | TypeScript 类型：Message + SendMessageParams 增加 `mention_ids` | `types/index.ts` | +4 行 |
| 3 | Go Model：Message 增加 `MentionIDs` | `go-chat-server/model/message.go` | +2 行 |
| 4 | Service 层：Supabase + Go 适配器传递 `mention_ids` | `chatService.ts`、`goChatService.ts` | 各 +3 行 |
| 5 | Store：sendMessage 签名增加 `mentionIds` 参数；通知/摘要增强 | `stores/chat.ts` | ~25 行 |
| 6 | MentionSelector 组件（新建） | `components/chat/MentionSelector.vue` | ~180 行 |
| 7 | InputArea：@ 输入监听 + 集成 MentionSelector + extractMentions | `views/chat/InputArea.vue` | ~80 行 |
| 8 | ChatWindow：@当前用户特殊气泡 + `@昵称` 蓝色高亮渲染 | `views/chat/ChatWindow.vue` | ~50 行 |

---

## 7. 边界情况

| 场景 | 处理策略 |
|------|---------|
| 群成员列表为空（尚未加载） | MentionSelector 顶部仍显示 `@所有人` 项，成员区域显示 "加载中..."，异步 fetchGroupMembers |
| @ 后面没有关键词 | 显示 `@所有人` + 全部群成员（排除自己） |
| @ 后面输入的关键词无匹配 | 仍显示 `@所有人` 项，成员区域显示 "无匹配成员" |
| 用户手动输入 `@所有人`（不走选择器） | 发送时正则匹配 `@所有人`，mention_ids 中写入 `"ALL"` |
| 用户手动输入 `@某人`（不走选择器） | 发送时遍历文本提取 mention_ids（兼容手动输入） |
| 单聊中输入 @ | 不弹出选择器，不做特殊处理 |
| 消息撤回 | mention_ids 随消息内容一起清除 |
| 被 @ 后消息被撤回 | 气泡恢复为普通撤回样式 |
| `@所有人` + 同时 @ 特定成员 | mention_ids 数组同时含 `"ALL"` + 具体 user_id |

---

## 8. 未来 Phase 2

- 被 @ 消息的独立 Tab 聚合视图（"提及"Tab）
- 免打扰群 @ 消息的静默处理选项
- `@所有人` 权限控制（如需限制仅群主/管理员可用，加上开关即可）
