# 聊天记录搜索功能 — 详细实施计划

> 版本：v1.0 | 日期：2026-06-29 | 状态：规划中

---

## 目录

1. [现状分析](#1-现状分析)
2. [功能范围与分阶段规划](#2-功能范围与分阶段规划)
3. [入口设计](#3-入口设计)
4. [UI/UX 详细设计](#4-uiux-详细设计)
5. [架构改动清单](#5-架构改动清单)
6. [类型定义扩展](#6-类型定义扩展)
7. [Service 层改动](#7-service-层改动)
8. [Store 层改动](#8-store-层改动)
9. [新组件与现有组件改动](#9-新组件与现有组件改动)
10. [后端改动](#10-后端改动)
11. [性能与索引策略](#11-性能与索引策略)
12. [边界情况与容错](#12-边界情况与容错)
13. [验收标准](#13-验收标准)
14. [工作量估算](#14-工作量估算)

---

## 1. 现状分析

### 1.1 当前已有的消息加载能力

| 能力 | 实现位置 | 说明 |
|------|----------|------|
| 私聊历史加载 | [`chatService.ts:fetchHistory()`](client-chat-tauri/src/services/chatService.ts:137) | 游标分页，`created_at DESC`，每次 20 条 |
| 群聊历史加载 | [`chatService.ts:fetchGroupHistory()`](client-chat-tauri/src/services/chatService.ts:778) | 同上 |
| 上拉加载更多 | [`chat.ts:loadMoreHistory()`](client-chat-tauri/src/stores/chat.ts:535) / [`loadMoreGroupHistory()`](client-chat-tauri/src/stores/chat.ts:645) | 滚动到顶部自动触发 |
| Go 后端私聊历史 | [`message_store.go:GetHistory()`](go-chat-server/service/message_store.go:82) | 双向 OR 查询，DESC |
| Go 后端群聊历史 | [`message_store.go:GetGroupHistory()`](go-chat-server/service/message_store.go:116) | 按 group_id 过滤，DESC |

### 1.2 当前缺失的能力

- **关键词搜索**：不支持对 `messages.content` 做关键词匹配
- **日期范围过滤**：不支持按 `created_at` 范围筛选
- **跨会话搜索**：无法同时在多个会话中搜索
- **搜索结果高亮**：UI 层无关键字高亮逻辑
- **搜索结果导航**：无"上一条/下一条"跳转

### 1.3 数据库层面现状

| 后端 | 消息表 | content 列 | 可用索引 |
|------|--------|-----------|----------|
| Supabase / PostgreSQL | `public.messages` | `TEXT` | 仅有 `created_at` 普通索引，无全文索引 |
| Go / MySQL | `messages` | `TEXT` | 同 PostgreSQL |

---

## 2. 功能范围与分阶段规划

### Phase 1 — 当前会话搜索（核心功能）

- [ ] 类型定义扩展：`SearchMessagesParams`、`SearchResultItem`、`SearchResult`
- [ ] `IChatService` 新增 `searchMessages()` 方法
- [ ] Supabase 适配器实现 `searchMessages`
- [ ] Go 适配器实现 `searchMessages`
- [ ] Go 后端新增 `GET /api/messages/search` 路由 + Handler + Service
- [ ] Store 新增搜索状态 + `searchMessages` / `searchNext` / `searchPrev` / `clearSearch`
- [ ] 新组件 `SearchBar.vue`（内嵌搜索条）
- [ ] `ChatWindow.vue` 顶栏新增搜索按钮 + 搜索条集成
- [ ] 关键字高亮 + 匹配计数 + 上下导航

### Phase 2 — 日期搜索 + 索引优化

- [ ] 搜索条日期范围选择器（两个 `type="date"` 输入框）
- [ ] Supabase：创建 `pg_trgm` 扩展 + GIN 索引迁移脚本 (`supabase-sql/10_add_message_search_index.sql`)
- [ ] MySQL：添加 `FULLTEXT` 索引或普通 `INDEX(content(255))`（视数据量而定）

### Phase 3 — 全局搜索 + 快捷键

- [ ] 新组件 `GlobalSearchDrawer.vue`（全局搜索 Drawer）
- [ ] 按会话分组展示搜索结果
- [ ] 点击结果 → 自动跳转到对应会话 → 定位到该消息
- [ ] 快捷键 `Ctrl+Shift+F`
- [ ] Sidebar 新增全局搜索图标

---

## 3. 入口设计

### 入口 1：ChatWindow 顶栏搜索按钮（Phase 1，主入口）

**位置**：在 [`ChatWindow.vue` header](client-chat-tauri/src/views/chat/ChatWindow.vue:698) 区域右侧。

- 群聊顶栏：群设置按钮（`...`）左侧新增 🔍 搜索按钮
- 私聊顶栏：标题右侧新增 🔍 搜索按钮

**行为**：

```
点击 🔍 → 搜索条从顶栏下方滑入（高度约 48px）
         → 输入框自动聚焦
         → 消息区域高度自动缩减 48px（搜索条占用空间）
点击 ✕ / 再次点击 🔍 → 搜索条滑出 → 恢复完整消息列表
```

**视觉**：
- 搜索条背景色：`bg-[var(--color-bg-elevated)]`
- 与消息区之间有 `border-b border-[var(--color-border-default)]`
- 使用 Vue `<Transition name="slide-down">` 动画

### 入口 2：快捷键 `Ctrl+Shift+F`（Phase 3）

**位置**：[`Index.vue onKeyDown()`](client-chat-tauri/src/views/chat/Index.vue:20) 中新增。

```ts
if (e.ctrlKey && e.shiftKey && e.key === 'F') {
  e.preventDefault()
  chatStore.showGlobalSearch = true
}
```

**行为**：打开全局搜索 Drawer，输入框自动聚焦。

### 入口 3：Sidebar 全局搜索图标（Phase 3）

**位置**：[`Sidebar.vue`](client-chat-tauri/src/views/chat/Sidebar.vue:24) 图标竖列中，在创建群聊按钮下方新增全局搜索按钮。

**视觉**：使用 `🔍` 放大镜 SVG 图标，与现有图标风格一致（`w-12 h-12 rounded-2xl`）。

---

## 4. UI/UX 详细设计

### 4.1 当前会话搜索条 (`SearchBar.vue`) — Phase 1

#### 布局规格

```
┌─────────────────────────────────────────────────────────────┐
│ 🔍 [________________搜索关键词...________________] ↑3/12↓  ✕ │
│    📅 [2025-06-01]  —  [2025-06-29]                        │
└─────────────────────────────────────────────────────────────┘
```

#### 元素说明

| 元素 | 类型 | 行为 |
|------|------|------|
| 🔍 图标 | SVG 图标 | 纯装饰 |
| 关键词输入框 | `<input type="text">` | `@input` 300ms 防抖 → `chatStore.searchMessages()`；`@keydown.enter` → `searchNext()`；`@keydown.escape` → `clearSearch()` |
| 匹配计数 `↑3/12↓` | `<span>` | 当前匹配索引 / 总匹配数；点击 ↑ ↓ 或按 `Enter`/`Shift+Enter` 跳转 |
| ✕ 关闭按钮 | `<button>` | 清空搜索、隐藏搜索条、恢复完整消息列表 |
| 日期范围选择器 | 两个 `<input type="date">` (Phase 2) | 选择后自动重新搜索 |

#### 与 ChatWindow 交互

1. 搜索条通过 props 或直接读取 `chatStore.showSearchPanel`
2. 当 `showSearchPanel = true` 时，`ChatWindow` 的消息区 `displayMessages` computed 自动切换为仅渲染匹配的消息
3. 搜索条调用 `chatStore.searchNext/Prev` → ChatWindow 执行 `scrollIntoView` 定位到对应消息
4. 关键词通过 `chatStore.searchKeyword` 传给 ChatWindow，在 `renderMentionText` 旁新增 `highlightKeyword` 处理

#### 动画

```css
.slide-down-enter-active { transition: all 0.25s ease-out; }
.slide-down-leave-active { transition: all 0.2s ease-in; }
.slide-down-enter-from,
.slide-down-leave-to { opacity: 0; transform: translateY(-100%); }
```

### 4.2 关键字高亮规则（ChatWindow.vue 改动）

在 [`ChatWindow.vue`](client-chat-tauri/src/views/chat/ChatWindow.vue:36) 的 `renderMentionText` 之后，新增 `highlightKeyword` 函数：

```ts
function highlightKeyword(text: string, keyword: string): string {
  if (!keyword) return text
  const escaped = escapeHtml(keyword)
  // 对已转义的文本中匹配 keyword 的部分包裹 <mark class="search-highlight">
  // 使用正则，不区分大小写，已转义的 HTML 标签内容不参与匹配
  // ...
}
```

高亮样式：

```css
.search-highlight {
  background: rgba(250, 204, 21, 0.35);
  border-radius: 2px;
  color: inherit;
  padding: 0 1px;
}
/* 当前激活的匹配项 */
.search-highlight-active {
  background: rgba(250, 140, 21, 0.6);
  outline: 2px solid rgba(251, 146, 60, 0.5);
  outline-offset: 1px;
}
```

### 4.3 搜索模式下消息列表行为

- `displayMessages` computed 中，若 `chatStore.searchKeyword` 非空：
  - 过滤：仅保留 `content` 包含关键词的消息（`msg_type='text'` 匹配 content；`image/file/voice` 匹配 `file_name`）
  - 保持原有时间分隔线逻辑
- 消息气泡不改变左右布局（自己的靠右，他人靠左）
- 当前激活匹配项（`searchActiveIndex`）的消息气泡添加边框高亮 + 自动 `scrollIntoView({ block: 'center', behavior: 'smooth' })`

### 4.4 搜索导航流程

```
用户输入 "文档"
  → 300ms 后 → chatStore.searchMessages("文档")
    → Service 查询 → 返回 12 条匹配
  → ChatWindow 展示 12 条消息 + 顶部分隔线
  → 搜索条显示 "↑1/12↓"
  → 自动定位到第 1 条（最新匹配）

用户按 ↓ 或 Enter
  → searchActiveIndex 2 → 第 2 条高亮 + scrollIntoView

用户按 ↑ 或 Shift+Enter
  → searchActiveIndex 1 → 第 1 条高亮 + scrollIntoView

用户按 Escape
  → clearSearch() → 恢复完整消息列表
```

### 4.5 全局搜索 Drawer (`GlobalSearchDrawer.vue`) — Phase 3

#### 布局规格

```
┌──────────────────────────────────────────────────────┐
│  🔍 全局搜索                                    [✕]  │
│  ┌────────────────────────────────────────────────┐  │
│  │ 输入关键词...                                  │  │
│  └────────────────────────────────────────────────┘  │
│  📅 [从日期]  —  [到日期]          搜索到 8 条结果  │
│  ────────────────────────────────────────────────── │
│  ┌────────────────────────────────────────────────┐  │
│  │ 📁 与 张三 的私聊                        (3条) │  │  ← 会话分组头
│  │ ┌─────────────────────────────────────────┐   │  │
│  │ │ 张三                             14:30  │   │  │  ← 消息条目
│  │ │ 你好，那个██文档██发我一下...          │   │  │
│  │ └─────────────────────────────────────────┘   │  │
│  │ ┌─────────────────────────────────────────┐   │  │
│  │ │ 我                               9:15   │   │  │
│  │ │ 好的，马上发你                          │   │  │
│  │ └─────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │ 📁 技术群                              (2条) │  │
│  │ ...                                            │  │
│  └────────────────────────────────────────────────┘  │
│  ────────────────────────────────────────────────── │
│  （无更多结果时）没有更多了                         │
└──────────────────────────────────────────────────────┘
```

#### 行为

- 点击某条消息 → 关闭 Drawer → 判断 `conversation_type`：
  - `friend`：`chatStore.setActiveFriend(friendId)` → 消息加载完毕后用 `data-msg-id` 定位 + 闪烁高亮 2 秒
  - `group`：`chatStore.setActiveGroup(groupId)` → 同上
- 点击某条消息时需临时设置 `chatStore.searchKeyword`，使 ChatWindow 能高亮该关键词
- Drawer 宽度：约 560px（桌面端），在小屏幕上占满全屏
- 进入 Drawer 时搜索关键词为空，显示"输入关键词开始搜索"提示

---

## 5. 架构改动清单

```
                           ┌─────────────────┐
                           │  types/index.ts │  ← 新增 3 个接口 + 1 个 IChatService 方法
                           └────────┬────────┘
                                    │ implements
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
   ┌──────────▼──────────┐ ┌───────▼────────┐  ┌─────────▼──────────┐
   │ chatService.ts      │ │ goChatService  │  │ Go 后端             │
   │ (Supabase 适配器)   │ │ (Go 适配器)    │  │ message_store.go    │
   │ + searchMessages()  │ │ + searchMessages│  │ + SearchMessages()  │
   └──────────┬──────────┘ └───────┬────────┘  │ router.go           │
              │                     │           │ + GET /api/msgs/... │
              └─────────────────────┼───────────┘                     │
                                    │                                 │
                           ┌────────▼────────┐                        │
                           │ stores/chat.ts  │  ← 新增搜索状态 + 方法 │
                           └────────┬────────┘                        │
                                    │                                 │
              ┌─────────────────────┼─────────────────────┐           │
              │                     │                     │           │
   ┌──────────▼──────────┐ ┌───────▼────────────┐ ┌──────▼───────┐   │
   │ SearchBar.vue       │ │ ChatWindow.vue     │ │ GlobalSearch │   │
   │ (新组件, Phase 1)   │ │ (改动, Phase 1)    │ │ Drawer.vue   │   │
   └─────────────────────┘ └────────────────────┘ │ (新, Phase 3)│   │
                                                   └──────────────┘   │
```

---

## 6. 类型定义扩展

**文件**：[`client-chat-tauri/src/types/index.ts`](client-chat-tauri/src/types/index.ts)

### 6.1 新增接口

```ts
/** 消息搜索参数 */
export interface SearchMessagesParams {
  /** 关键词（content / file_name 模糊匹配） */
  keyword: string
  /** 日期范围起点 (ISO date string, 如 '2025-06-01') */
  dateFrom?: string
  /** 日期范围终点 (ISO date string, 如 '2025-06-29') */
  dateTo?: string
  /** 限定私聊好友 ID（与 groupId 互斥；均不传则为全局搜索） */
  friendId?: string
  /** 限定群组 ID（与 friendId 互斥；均不传则为全局搜索） */
  groupId?: string
  /** 分页游标：上一页最后一条的 created_at */
  before?: string
  /** 每页条数，默认 20，上限 100 */
  limit?: number
}

/** 搜索结果项：Message + 会话上下文 */
export interface SearchResultItem extends Message {
  /** 会话类型 */
  conversation_type: 'friend' | 'group'
  /** 会话名称（好友昵称 / 群名） */
  conversation_name: string
  /** 会话头像 URL */
  conversation_avatar_url?: string
}

/** 搜索结果 */
export interface SearchResult {
  items: SearchResultItem[]
  hasMore: boolean
  totalCount?: number
}
```

### 6.2 IChatService 新增方法

```ts
export interface IChatService {
  // ... 现有方法 ...

  /**
   * 搜索历史消息
   * - 支持关键词模糊匹配（content + file_name）
   * - 支持日期范围过滤
   * - 支持限定私聊/群聊会话
   * - 支持游标分页
   */
  searchMessages(params: SearchMessagesParams): Promise<SearchResult>
}
```

---

## 7. Service 层改动

### 7.1 Supabase 适配器 — [`chatService.ts`](client-chat-tauri/src/services/chatService.ts)

在 `SupabaseChatService` 类中新增方法：

```ts
async searchMessages(params: SearchMessagesParams): Promise<SearchResult> {
  const supabase = getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')

  const limit = Math.min(params.limit ?? 20, 100)

  // 基础查询
  let query = supabase
    .from('messages')
    .select('*', { count: 'exact' })  // count: 'exact' 获取 totalCount

  // 关键词过滤（ILIKE 不区分大小写）
  if (params.keyword) {
    const kw = `%${params.keyword}%`
    query = query.or(`content.ilike.${kw},file_name.ilike.${kw}`)
  }

  // 排除已撤回消息（接收者不应看到）
  // 注意：自己的撤回消息仍然可见（显示为"你撤回了一条消息"）
  // 此处简化处理：全局排除 is_revoked=true；ChatWindow 中再按身份恢复

  // 日期范围
  if (params.dateFrom) {
    query = query.gte('created_at', params.dateFrom)
  }
  if (params.dateTo) {
    query = query.lte('created_at', params.dateTo + 'T23:59:59')
  }

  // 会话限定
  if (params.groupId) {
    query = query.eq('group_id', params.groupId)
  } else if (params.friendId) {
    query = query.or(
      `and(sender_id.eq.${user.id},receiver_id.eq.${params.friendId}),` +
      `and(sender_id.eq.${params.friendId},receiver_id.eq.${user.id})`
    )
  } else {
    // 全局搜索：该用户参与的所有消息（私聊双向 + 所在群聊）
    // 方式：sender_id = user.id OR receiver_id = user.id OR group_id IN (用户的群)
    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)
    const groupIds = (myGroups ?? []).map((r: any) => r.group_id)

    const orConditions = [
      `sender_id.eq.${user.id}`,
      `receiver_id.eq.${user.id}`,
    ]
    if (groupIds.length > 0) {
      // Supabase or() 支持最多 3 个条件，群太多需要简化
      orConditions.push(`group_id.in.(${groupIds.join(',')})`)
    }
    query = query.or(orConditions.join(','))
  }

  // 排序 + 分页
  query = query.order('created_at', { ascending: false }).limit(limit + 1)

  if (params.before) {
    query = query.lt('created_at', params.before)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`搜索消息失败: ${error.message}`)

  const msgs = (data ?? []) as Message[]
  const hasMore = msgs.length > limit
  if (hasMore) msgs.pop()

  // 组装 SearchResultItem（需要填充 conversation_name / avatar_url）
  // 此处需要额外查询 profiles 和 groups 表来获取会话名称
  const items: SearchResultItem[] = await Promise.all(
    msgs.map(async (msg) => {
      // ... 判断 conversation_type、查询名称和头像
    })
  )

  return { items, hasMore, totalCount: count ?? 0 }
}
```

**性能注意事项**：
- `ILIKE '%keyword%'` 无法使用 B-tree 索引，数据量 >10 万条时需 `pg_trgm` GIN 索引（见 [§11](#11-性能与索引策略)）
- 全局搜索可能涉及大量消息，`limit` 上限设为 100
- 批量查询 profiles/groups 名称时应使用 `Promise.all` 并行

### 7.2 Go 适配器 — [`goChatService.ts`](client-chat-tauri/src/services/goChatService.ts)

在 `GoChatService` 类中新增方法：

```ts
async searchMessages(params: SearchMessagesParams): Promise<SearchResult> {
  const token = localStorage.getItem('go-chat-token')
  const qs = new URLSearchParams()
  qs.set('keyword', params.keyword)
  qs.set('limit', String(Math.min(params.limit ?? 20, 100)))
  if (params.dateFrom) qs.set('date_from', params.dateFrom)
  if (params.dateTo) qs.set('date_to', params.dateTo)
  if (params.friendId) qs.set('friend_id', params.friendId)
  if (params.groupId) qs.set('group_id', params.groupId)
  if (params.before) qs.set('before', params.before)

  const res = await fetch(
    `${this.baseUrl()}/api/messages/search?${qs.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!res.ok) throw new Error(`搜索消息失败: HTTP ${res.status}`)
  const json = await res.json()
  if (json.code !== 200) throw new Error(`搜索消息失败: ${json.message}`)

  return {
    items: json.data.items as SearchResultItem[],
    hasMore: json.data.has_more as boolean,
    totalCount: json.data.total_count as number,
  }
}
```

---

## 8. Store 层改动

**文件**：[`client-chat-tauri/src/stores/chat.ts`](client-chat-tauri/src/stores/chat.ts)

### 8.1 新增状态

```ts
// ========== 搜索状态 ==========

/** 搜索面板是否可见 */
const showSearchPanel = ref(false)

/** 当前搜索关键词 */
const searchKeyword = ref('')

/** 搜索日期范围起点 */
const searchDateFrom = ref('')

/** 搜索日期范围终点 */
const searchDateTo = ref('')

/** 搜索结果列表（只包含匹配的消息） */
const searchResults = ref<Message[]>([])

/** 搜索结果是否还有更多 */
const searchHasMore = ref(false)

/** 搜索结果总数 */
const searchTotalCount = ref(0)

/** 是否正在搜索 */
const searchIsLoading = ref(false)

/** 当前激活的匹配项索引（0-based，在 searchResults 数组中） */
const searchActiveIndex = ref(0)

/** 防抖定时器 ID */
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
```

### 8.2 新增计算属性

```ts
/** 当前搜索匹配总数 */
const searchMatchCount = computed(() => searchResults.value.length)

/** 搜索是否激活（有关键词且面板可见） */
const isSearchActive = computed(() => showSearchPanel.value && searchKeyword.value.trim().length > 0)
```

### 8.3 新增方法

```ts
/**
 * 执行消息搜索（带 300ms 防抖）
 * @param keyword 搜索关键词
 * @param dateFrom 日期范围起点 (ISO date, 可选)
 * @param dateTo 日期范围终点 (ISO date, 可选)
 */
function searchMessages(keyword: string, dateFrom?: string, dateTo?: string) {
  searchKeyword.value = keyword

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)

  if (!keyword.trim()) {
    searchResults.value = []
    searchActiveIndex.value = 0
    searchTotalCount.value = 0
    return
  }

  searchDebounceTimer = setTimeout(async () => {
    searchIsLoading.value = true
    try {
      const authStore = useAuthStore()
      if (!authStore.currentUser) return

      const params: {
        keyword: string
        dateFrom?: string
        dateTo?: string
        friendId?: string
        groupId?: string
        limit: number
      } = {
        keyword: keyword.trim(),
        limit: 50, // 搜索给更大 limit
      }

      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo

      // 当前会话搜索：限定当前会话
      if (activeGroup.value) {
        params.groupId = activeGroup.value.id
      } else if (activeFriend.value) {
        params.friendId = activeFriend.value.friend_id
      }

      const result = await chatService.searchMessages(params)

      const filtered = filterRevoked(result.items, authStore.currentUser.id)
      searchResults.value = filtered
      searchTotalCount.value = result.totalCount ?? filtered.length
      searchHasMore.value = result.hasMore
      searchActiveIndex.value = filtered.length > 0 ? 0 : -1

      // 搜索完成后自动定位到第一条匹配
      if (filtered.length > 0) {
        await nextTick()
        // ChatWindow 会通过 watch(searchActiveIndex) 或方法执行 scrollIntoView
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '搜索消息失败')
    } finally {
      searchIsLoading.value = false
    }
  }, 300)
}

/** 跳转到下一个匹配项（循环） */
function searchNext() {
  if (searchResults.value.length === 0) return
  searchActiveIndex.value =
    (searchActiveIndex.value + 1) % searchResults.value.length
}

/** 跳转到上一个匹配项（循环） */
function searchPrev() {
  if (searchResults.value.length === 0) return
  searchActiveIndex.value =
    searchActiveIndex.value === 0
      ? searchResults.value.length - 1
      : searchActiveIndex.value - 1
}

/** 清除搜索状态并关闭搜索面板 */
function clearSearch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchKeyword.value = ''
  searchDateFrom.value = ''
  searchDateTo.value = ''
  searchResults.value = []
  searchHasMore.value = false
  searchTotalCount.value = 0
  searchActiveIndex.value = 0
  showSearchPanel.value = false
  searchIsLoading.value = false
}
```

### 8.4 现有方法影响

- `loadHistory` / `loadGroupHistory`：**不受影响**，搜索独立于历史加载
- `displayMessages`（ChatWindow computed）：需根据 `isSearchActive` 切换数据源。可以考虑在 ChatWindow 中新增 computed `effectiveMessages`：
  ```ts
  const effectiveMessages = computed(() => {
    return chatStore.isSearchActive
      ? chatStore.searchResults
      : chatStore.messages
  })
  ```

### 8.5 导出清单

在 `return {}` 中新增：

```ts
// 搜索
showSearchPanel,
searchKeyword,
searchDateFrom,
searchDateTo,
searchResults,
searchHasMore,
searchTotalCount,
searchIsLoading,
searchActiveIndex,
searchMatchCount,
isSearchActive,
searchMessages,
searchNext,
searchPrev,
clearSearch,
```

---

## 9. 新组件与现有组件改动

### 9.1 新组件：`SearchBar.vue`（Phase 1）

**文件**：`client-chat-tauri/src/components/chat/SearchBar.vue`

**Props**：无（直接从 `chatStore` 读取状态）

**Emits**：`close`

**模板结构**：

```vue
<template>
  <Transition name="slide-down">
    <div
      v-if="chatStore.showSearchPanel"
      class="flex flex-col bg-[var(--color-bg-elevated)] border-b border-[var(--color-border-default)] px-4 py-2 gap-1.5"
    >
      <!-- 第一行：搜索输入 + 导航 + 关闭 -->
      <div class="flex items-center gap-2">
        <svg><!-- 搜索图标 --></svg>
        <input
          ref="searchInput"
          v-model="localKeyword"
          type="text"
          placeholder="搜索聊天记录..."
          class="flex-1 bg-transparent ..."
          @input="onInput"
          @keydown.enter="chatStore.searchNext()"
          @keydown.escape="handleClose"
        />
        <!-- 匹配计数 + 导航 -->
        <template v-if="chatStore.isSearchActive">
          <span class="text-[12px] text-[var(--color-text-muted)] whitespace-nowrap">
            {{ chatStore.searchActiveIndex + 1 }}/{{ chatStore.searchMatchCount }}
          </span>
          <button @click="chatStore.searchPrev()" title="上一条">↑</button>
          <button @click="chatStore.searchNext()" title="下一条">↓</button>
        </template>
        <!-- 加载中 -->
        <span v-if="chatStore.searchIsLoading" class="spinner"></span>
        <!-- 关闭 -->
        <button @click="handleClose" title="关闭搜索">✕</button>
      </div>

      <!-- 第二行：日期范围选择（Phase 2） -->
      <div v-if="showDateRange" class="flex items-center gap-2">
        <input type="date" v-model="localDateFrom" @change="onDateChange" />
        <span>—</span>
        <input type="date" v-model="localDateTo" @change="onDateChange" />
      </div>
    </div>
  </Transition>
</template>
```

**关键逻辑**：

```ts
const localKeyword = ref('')
const localDateFrom = ref('')
const localDateTo = ref('')
const searchInput = ref<HTMLInputElement>()

// 当 showSearchPanel 变为 true 时自动聚焦
watch(() => chatStore.showSearchPanel, (val) => {
  if (val) nextTick(() => searchInput.value?.focus())
})

function onInput() {
  chatStore.searchMessages(localKeyword.value, localDateFrom.value || undefined, localDateTo.value || undefined)
}

function onDateChange() {
  if (localKeyword.value.trim()) {
    chatStore.searchMessages(localKeyword.value, localDateFrom.value || undefined, localDateTo.value || undefined)
  }
}

function handleClose() {
  chatStore.clearSearch()
}
```

### 9.2 ChatWindow.vue 改动（Phase 1）

#### 顶栏改动

在群聊和私聊顶栏右侧均新增搜索按钮：

```html
<!-- 群聊顶栏 header 内，群设置按钮旁边 -->
<button
  class="w-8 h-8 rounded-lg flex items-center justify-center ..."
  title="搜索聊天记录"
  @click="toggleSearch"
>
  <svg><!-- 放大镜图标 --></svg>
</button>

<!-- 私聊顶栏 header 内 -->
<button ... @click="toggleSearch">...</button>
```

#### 消息列表数据源切换

```ts
const effectiveMessages = computed(() => {
  if (chatStore.isSearchActive && chatStore.searchResults.length > 0) {
    return chatStore.searchResults
  }
  // 即使 isSearchActive 但无结果（keyword 为空或未搜索），仍显示正常列表
  return chatStore.messages
})
```

`displayMessages` computed 改为使用 `effectiveMessages` 而非 `chatStore.messages`。

#### 关键字高亮

在 [`renderMentionText`](client-chat-tauri/src/views/chat/ChatWindow.vue:36) 逻辑之后新增：

```ts
function renderMessageContent(msg: Message): string {
  let html = msg.msg_type === 'text' ? escapeHtml(msg.content) : ''
  
  // 先渲染 @mention
  html = html.replace(/@(所有人|\S+)/g, '<span class="text-blue-400 font-medium">@$1</span>')
  
  // 再高亮搜索关键词
  if (chatStore.isSearchActive && chatStore.searchKeyword) {
    const kw = escapeHtml(chatStore.searchKeyword)
    // 用正则替换（不区分大小写），不匹配 HTML 标签内
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    html = html.replace(regex, '<mark class="search-highlight">$1</mark>')
  }
  
  return html
}
```

#### 当前激活匹配项高亮

在消息气泡 `:class` 中添加：

```ts
:class="{
  ...,
  'ring-2 ring-orange-400/50': chatStore.isSearchActive
    && chatStore.searchResults[chatStore.searchActiveIndex]?.id === item.id
}"
```

#### 搜索导航滚动

Watch `chatStore.searchActiveIndex`：

```ts
watch(
  () => chatStore.searchActiveIndex,
  (idx) => {
    if (idx < 0 || !containerRef.value) return
    const msgId = chatStore.searchResults[idx]?.id
    if (!msgId) return
    nextTick(() => {
      const el = containerRef.value!.querySelector(`[data-msg-id="${msgId}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }
)
```

### 9.3 Index.vue 改动（Phase 1）

在聊天主网格 `<div class="flex-1 grid grid-cols-[64px_280px_1fr]...">` 中，将第三列区域包裹为一个容器，其中包含 SearchBar + ChatWindow + InputArea：

```html
<div class="flex flex-col overflow-hidden">
  <SearchBar />           <!-- 搜索条（条件渲染） -->
  <ChatWindow class="flex-1" />
  <InputArea />
</div>
```

注意 `SearchBar` 的渲染不应改变网格布局，因为它和 `ChatWindow` 在同一个 flex column 内。

### 9.4 新组件：`GlobalSearchDrawer.vue`（Phase 3）

**文件**：`client-chat-tauri/src/components/chat/GlobalSearchDrawer.vue`

**Props**：`visible: boolean`

**核心逻辑**：
- `@input` 300ms 防抖 → `chatService.searchMessages({ keyword, limit: 50 })`（不传 friendId/groupId）
- 结果按 `conversation_type + conversation_name` 分组
- 点击某条 → 关闭 Drawer → `chatStore.setActiveFriend/Group` → 定位消息

---

## 10. 后端改动

### 10.1 Go 后端 — Service 层

**文件**：`go-chat-server/service/message_store.go`

新增方法：

```go
// SearchMessages 搜索历史消息（支持关键词、日期范围、会话限定、分页）
func (s *MessageStoreService) SearchMessages(
    ctx context.Context,
    keyword, dateFrom, dateTo, friendID, groupID, userID string,
    before string, limit int,
) ([]model.Message, int64, bool, error) {
    if limit <= 0 || limit > 100 {
        limit = 20
    }

    query := global.DB.WithContext(ctx).Model(&model.Message{})

    // 关键词模糊匹配（content + file_name）
    if keyword != "" {
        kw := "%" + keyword + "%"
        query = query.Where("content LIKE ? OR file_name LIKE ?", kw, kw)
    }

    // 日期范围
    if dateFrom != "" {
        query = query.Where("created_at >= ?", dateFrom)
    }
    if dateTo != "" {
        query = query.Where("created_at <= ?", dateTo+" 23:59:59")
    }

    // 会话限定
    if groupID != "" {
        query = query.Where("group_id = ?", groupID)
    } else if friendID != "" {
        query = query.Where(
            "(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
            userID, friendID, friendID, userID,
        )
    } else {
        // 全局搜索：用户参与的所有消息
        // 简化：sender_id = userID OR receiver_id = userID
        // 群聊消息通过 sender_id 覆盖（群消息的 sender_id 可能为用户）
        query = query.Where("sender_id = ? OR receiver_id = ?", userID, userID)
    }

    // 游标分页
    if before != "" {
        beforeTime, err := time.Parse(time.RFC3339, before)
        if err == nil {
            query = query.Where("created_at < ?", beforeTime)
        }
    }

    // 计数
    var total int64
    query.Count(&total)

    // 分页查询
    query = query.Order("created_at DESC").Limit(limit + 1)

    var messages []model.Message
    if err := query.Find(&messages).Error; err != nil {
        return nil, 0, false, fmt.Errorf("搜索消息失败: %w", err)
    }

    hasMore := len(messages) > limit
    if hasMore {
        messages = messages[:limit]
    }

    return messages, total, hasMore, nil
}
```

### 10.2 Go 后端 — API 层

**新文件或扩展**：`go-chat-server/api/message.go`（如已有则扩展）

新增 Handler：

```go
// SearchMessages 搜索历史消息
func SearchMessages(c *gin.Context) {
    keyword := c.Query("keyword")
    dateFrom := c.Query("date_from")
    dateTo := c.Query("date_to")
    friendID := c.Query("friend_id")
    groupID := c.Query("group_id")
    before := c.Query("before")
    limitStr := c.Query("limit")

    limit := 20
    if limitStr != "" {
        if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 100 {
            limit = n
        }
    }

    userID := c.GetString("userID") // 从 JWT 中间件注入

    svc := &service.MessageStoreService{}
    messages, total, hasMore, err := svc.SearchMessages(
        c.Request.Context(),
        keyword, dateFrom, dateTo, friendID, groupID, userID,
        before, limit,
    )
    if err != nil {
        c.JSON(500, gin.H{"code": 500, "message": err.Error()})
        return
    }

    // 构建 SearchResultItem（填充会话名称和头像）
    items := buildSearchResultItems(c, messages, userID)

    c.JSON(200, gin.H{
        "code":    200,
        "message": "success",
        "data": gin.H{
            "items":       items,
            "has_more":    hasMore,
            "total_count": total,
        },
    })
}
```

### 10.3 Go 后端 — 路由

**文件**：`go-chat-server/initialize/router.go`

在 `auth` Group 的消息相关路由区域新增：

```go
// -- 消息搜索 --
auth.GET("/messages/search", api.SearchMessages)
```

### 10.4 Supabase 后端

无需新增 RPC 或 Migration（一期直接用 Supabase SDK 查询）。Phase 2 添加性能索引（见 [§11](#11-性能与索引策略)）。

---

## 11. 性能与索引策略

### 11.1 数据量评估

| 场景 | 单会话消息量 | 全局消息量 | LIKE 扫描耗时 |
|------|------------|-----------|---------------|
| 内网小团队 (< 50 人) | < 5000 条 | < 10 万条 | < 50ms，无需索引 |
| 中等规模 (50 ~ 200 人) | < 2 万条 | < 50 万条 | 100 ~ 500ms，建议索引 |
| 大规模 (> 200 人) | > 5 万条 | > 100 万条 | > 1s，必须索引 |

### 11.2 PostgreSQL 优化（Phase 2）

**迁移脚本**：`supabase-sql/10_add_message_search_index.sql`

```sql
-- 启用 pg_trgm 扩展（三元组模糊匹配索引）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- content 列 GIN 索引（加速 ILIKE '%keyword%'）
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON public.messages USING gin (content gin_trgm_ops);

-- file_name 列 GIN 索引
CREATE INDEX IF NOT EXISTS idx_messages_file_name_trgm
  ON public.messages USING gin (file_name gin_trgm_ops);

-- 复合索引：created_at DESC（加速日期范围 + 排序）
-- 已有基本索引时可跳过
CREATE INDEX IF NOT EXISTS idx_messages_created_at_desc
  ON public.messages (created_at DESC);
```

### 11.3 MySQL 优化（Phase 2）

```sql
-- content 列前缀索引（InnoDB 不支持函数索引 LIKE 优化，前缀索引为折中方案）
-- 仅加速 WHERE content LIKE 'keyword%'，无法加速 '%keyword%'
-- 如数据量大，考虑使用 MySQL FULLTEXT 索引
ALTER TABLE messages ADD FULLTEXT INDEX ft_content (content, file_name);
```

对应 Go 的 GORM 查询改为：

```go
query = query.Where("MATCH(content, file_name) AGAINST(? IN BOOLEAN MODE)", keyword)
```

### 11.4 前端优化

- **防抖 300ms**：减少请求频率
- **结果缓存**：相同关键词 + 相同日期范围时复用上次结果（可选）
- **分页上限 100**：避免一次加载过多数据
- **搜索结果不参与 Realtime**：搜索模式下暂停 WebSocket 消息追加

---

## 12. 边界情况与容错

| 边界情况 | 处理策略 |
|----------|----------|
| **关键词为空** | 不发起请求，显示完整消息列表 |
| **关键词包含特殊字符**（`%`, `_` 等） | 前端转义后传给后端；后端参数化查询防止 SQL 注入 |
| **无匹配结果** | 搜索条显示 "未找到相关消息"，ChatWindow 清空消息区 |
| **网络请求失败** | `toast.error` 提示，搜索条保持上次状态 |
| **搜索中切换会话** | `watch([activeFriendId, activeGroupId])` 中调用 `clearSearch()` |
| **撤回消息** | 搜索结果排除 `is_revoked=true`；发送者自己的撤回消息保留 |
| **日期范围无效**（dateFrom > dateTo） | 前端校验，提示 "起始日期不能晚于结束日期" |
| **XSS 防护** | 关键词先 `escapeHtml` 再包裹 `<mark>`，不直接 innerHTML |
| **空格/空白关键词** | `keyword.trim()` 后判断是否为空 |
| **消息中包含 HTML** | `escapeHtml` 先转义所有 HTML 实体，再进行高亮替换 |
| **窗口缩放** | 搜索条使用 `flex` 布局自适应 |
| **并发搜索** | 防抖 + 请求竞态处理（`AbortController` 取消上次请求） |

---

## 13. 验收标准

### Phase 1 验收标准

- [ ] 聊天顶栏显示 🔍 搜索按钮
- [ ] 点击搜索按钮 → 搜索条滑入 → 输入框自动聚焦
- [ ] 输入关键词 300ms 后自动发起搜索
- [ ] 匹配的消息气泡中关键字黄色高亮
- [ ] 搜索条显示匹配计数（如 "3/12"）
- [ ] 点击 ↑ / ↓ 或按 Enter / Shift+Enter 可在匹配项之间跳转
- [ ] 跳转时自动滚动到对应消息（居中）
- [ ] 点击 ✕ 或按 Escape 关闭搜索、恢复完整消息列表
- [ ] 切换会话时自动关闭搜索
- [ ] 群聊搜索和私聊搜索均正常工作
- [ ] 空结果时显示 "未找到相关消息"
- [ ] 搜索加载中显示 spinner

### Phase 2 验收标准

- [ ] 日期范围选择器可见、可交互
- [ ] 选择日期后自动重新搜索
- [ ] 日期校验：dateFrom ≤ dateTo
- [ ] `pg_trgm` 索引创建后搜索性能 < 200ms（10 万条数据）

### Phase 3 验收标准

- [ ] Sidebar 全局搜索图标可见
- [ ] `Ctrl+Shift+F` 打开全局搜索 Drawer
- [ ] 搜索结果按会话分组展示
- [ ] 点击结果 → 跳转到对应会话 → 定位到该消息 → 消息闪烁高亮 2 秒
- [ ] Drawer 内支持分页加载更多

---

## 14. 工作量估算

| 阶段 | 任务 | 估计工时 |
|------|------|----------|
| **Phase 1** | 类型定义扩展 | 0.5h |
| | `chatService.ts` 新增 `searchMessages` | 2h |
| | `goChatService.ts` 新增 `searchMessages` | 1h |
| | Go 后端 API + Service + 路由 | 2.5h |
| | Store 搜索状态 + 方法 | 1.5h |
| | `SearchBar.vue` 新组件 | 2h |
| | `ChatWindow.vue` 顶栏改动 + 高亮 + 导航 | 2.5h |
| | `Index.vue` 布局集成 | 0.5h |
| | **Phase 1 小计** | **12.5h** |
| **Phase 2** | 日期选择器 | 1.5h |
| | PostgreSQL `pg_trgm` 索引迁移脚本 | 1h |
| | MySQL FULLTEXT 索引 | 0.5h |
| | 请求竞态处理 (`AbortController`) | 1h |
| | **Phase 2 小计** | **4h** |
| **Phase 3** | `GlobalSearchDrawer.vue` 新组件 | 3h |
| | Sidebar 搜索图标 | 0.5h |
| | 快捷键 `Ctrl+Shift+F` | 0.5h |
| | 跨会话跳转 + 消息定位 | 1.5h |
| | **Phase 3 小计** | **5.5h** |
| | **总计** | **~22h** |

---

> **附录**：本计划基于 2026-06-29 代码库分析编写。实现时若代码库有变更，请以实际文件内容为准。
