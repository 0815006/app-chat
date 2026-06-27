# 主题颜色切换改造方案

> 版本: v1.0  
> 日期: 2026-06-27  
> 状态: 待审核

---

## 1. 目标

支持用户在"深色主题"和"浅色主题"之间切换：

- 主题偏好持久化到用户信息表（`profiles.theme` / `users.theme`），默认 `dark`
- 登录后从数据库恢复主题偏好，自动应用
- 在个人信息弹窗（[`UserProfileDialog.vue`](../client-chat-tauri/src/components/chat/UserProfileDialog.vue)）中提供切换入口
- 切换后即时生效，无需刷新页面

---

## 2. 架构决策：CSS 变量 Token 方案

### 2.1 方案选型

| 方案 | 描述 | 结论 |
|------|------|------|
| Tailwind `dark:` 变体 | 每个颜色值写两遍 `bg-white dark:bg-gray-900` | ❌ 改动量大，散落各处 |
| **CSS 变量 Token** | 两套主题文件定义 `--color-*` 变量值，组件用 `var(--token)` | ✅ 集中管理，易扩展 |

### 2.2 文件结构

```
client-chat-tauri/src/
├── themes/
│   ├── tokens.css          # 声明所有 --color-* 变量（空壳，由 dark/light 填充）
│   ├── dark.css            # :root.dark { --color-bg-default: #1a1a2e; ... }
│   └── light.css           # :root { --color-bg-default: #f8f9fc; ... }（默认浅色值）
```

### 2.3 切换机制

```
authStore.theme === 'dark'  →  document.documentElement.classList.add('dark')
authStore.theme === 'light' →  document.documentElement.classList.remove('dark')
```

- `<html>` 无 class 时，CSS 变量取 `:root` 默认值（即浅色主题）
- `<html class="dark">` 时，CSS 变量被 `:root.dark` 覆盖为暗色值
- 切换仅改变 CSS 变量值，浏览器自动重绘，**零性能开销**

---

## 3. 颜色 Token 分类体系

### 3.1 当前暗色色值审计（完整统计）

通过逐文件审计 13 个 Vue 组件，当前暗色主题使用了以下硬编码色值：

#### 背景色（7 种色值 → 收敛为 4 级）

| Token | 暗色值 | 用途 | 出现位置 |
|-------|--------|------|---------|
| `--color-bg-deepest` | `#0f0f23` | 标题栏、最深区域 | TitleBar, FriendList 底部 |
| `--color-bg-deeper` | `#17132b` | 侧栏、输入框背景 | Sidebar, InputArea, FriendList |
| `--color-bg-default` | `#1a1a2e` | 主聊天区、登录页 | Index, ChatWindow, Login |
| `--color-bg-elevated` | `#1e1935` | 卡片、顶栏、弹窗 | ChatWindow header, FriendList, InputArea |

**弹窗专属深色背景**（比 `elevated` 更深）：

| Token | 暗色值 | 用途 | 出现位置 |
|-------|--------|------|---------|
| `--color-bg-dialog` | `#141028` | 弹窗/面板主背景 | AddFriendDialog, CreateGroupDialog, GroupMembersPanel |
| `--color-bg-dialog-input` | `#0f0b24` | 弹窗内输入框背景 | AddFriendDialog, CreateGroupDialog, GroupMembersPanel |
| `--color-bg-dialog-deep` | `#0c0820` | 弹窗内更深输入框 | GroupMembersPanel 邀请搜索框 |

#### 文字色（5 级）

| Token | 暗色值 | 用途 |
|-------|--------|------|
| `--color-text-primary` | `#e2e8f0` | 正文、标题、主文字 |
| `--color-text-heading` | `white` / `#ffffff` | 弹窗标题文字（⚠ 当前硬编码 `text-white`） |
| `--color-text-secondary` | `#a0aec0` | 次要标签、导航文字 |
| `--color-text-muted` | `#718096` | 辅助信息、时间戳、空态文字 |
| `--color-text-disabled` | `#4a5568` | 占位符、禁用态、非常用文字 |
| `--color-text-dim` | `#475569` | 极淡文字（弹窗副标题） |

#### 边框色（3 级）

| Token | 暗色值 | 用途 |
|-------|--------|------|
| `--color-border-default` | `#2d3748` | 通用边框、输入框边框 |
| `--color-border-strong` | `#2a1f5e` | 分割线、区域边框 |
| `--color-border-subtle` | `white/[0.06]` | 弹窗微边框（⚠ 透明度模式） |

#### 交互/叠加色（透明度模式 ⚠ 关键风险）

| Token | 暗色值 | 用途 |
|-------|--------|------|
| `--color-hover-bg` | `rgb(255 255 255 / 0.04)` | 列表项悬停背景 |
| `--color-hover-strong` | `rgb(255 255 255 / 0.06)` | 按钮悬停、较强反馈 |
| `--color-hover-weak` | `rgb(255 255 255 / 0.02)` | 轻微悬停/卡片背景 |
| `--color-active-bg` | `#252050` | 好友列表选中态 |
| `--color-overlay` | `rgb(0 0 0 / 0.50)` | 弹窗遮罩层 |
| `--color-overlay-light` | `rgb(0 0 0 / 0.30)` | 面板遮罩层 |

#### 输入框

| Token | 暗色值 | 用途 |
|-------|--------|------|
| `--color-input-bg` | `#17132b` | 通用输入框背景 |
| `--color-input-bg-alt` | `#1e293b` | 登录页输入框背景（与通用不同！） |

#### 滚动条

| Token | 暗色值 | 用途 |
|-------|--------|------|
| `--color-scrollbar-thumb` | `#2d3748` / `rgb(255 255 255 / 0.04)` | 滚动条滑块（两套值，需统一） |

#### 特殊色（品牌色，不随主题变化）

| 色值 | 用途 |
|------|------|
| `from-blue-400 to-green-400` | 品牌渐变按钮、发送按钮 |
| `from-purple-400 to-pink-400` | 群组相关渐变 |
| `blue-400` | 聚焦环、链接色 |
| `red-400/500` | 错误、删除、危险操作 |
| `green-400` | 成功、在线状态点 |
| `amber-400` | 群主标记 |
| `purple-400` | 群组选中态、邀请按钮 |

### 3.2 浅色主题配色推荐

| Token | 暗色值 | 浅色值（建议） |
|-------|--------|---------------|
| `--color-bg-deepest` | `#0f0f23` | `#e8ecf1` |
| `--color-bg-deeper` | `#17132b` | `#f0f2f5` |
| `--color-bg-default` | `#1a1a2e` | `#f8f9fc` |
| `--color-bg-elevated` | `#1e1935` | `#ffffff` |
| `--color-bg-dialog` | `#141028` | `#ffffff` |
| `--color-bg-dialog-input` | `#0f0b24` | `#f0f2f5` |
| `--color-bg-dialog-deep` | `#0c0820` | `#e8ecf1` |
| `--color-text-primary` | `#e2e8f0` | `#1a1a2e` |
| `--color-text-heading` | `#ffffff` | `#111827` |
| `--color-text-secondary` | `#a0aec0` | `#6b7280` |
| `--color-text-muted` | `#718096` | `#9ca3af` |
| `--color-text-disabled` | `#4a5568` | `#d1d5db` |
| `--color-text-dim` | `#475569` | `#9ca3af` |
| `--color-border-default` | `#2d3748` | `#e5e7eb` |
| `--color-border-strong` | `#2a1f5e` | `#d1d5db` |
| `--color-border-subtle` | `rgb(255 255 255 / 0.06)` | `rgb(0 0 0 / 0.06)` |
| `--color-hover-bg` | `rgb(255 255 255 / 0.04)` | `rgb(0 0 0 / 0.04)` |
| `--color-hover-strong` | `rgb(255 255 255 / 0.06)` | `rgb(0 0 0 / 0.06)` |
| `--color-hover-weak` | `rgb(255 255 255 / 0.02)` | `rgb(0 0 0 / 0.02)` |
| `--color-active-bg` | `#252050` | `#e0e7ff` |
| `--color-overlay` | `rgb(0 0 0 / 0.50)` | `rgb(0 0 0 / 0.40)` |
| `--color-overlay-light` | `rgb(0 0 0 / 0.30)` | `rgb(0 0 0 / 0.20)` |
| `--color-input-bg` | `#17132b` | `#f0f2f5` |
| `--color-input-bg-alt` | `#1e293b` | `#f0f2f5` |
| `--color-scrollbar-thumb` | `#d1d5db` | `#cbd5e1` |

> **注意**：浅色配色值为初步推荐，需要在实际渲染后根据视觉效果微调。

---

## 4. 数据库变更

### 4.1 Supabase（profiles 表）

新增 Migration SQL 文件 `docs/10_add_theme_column.sql`：

```sql
-- 为 profiles 表新增主题偏好字段
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';

COMMENT ON COLUMN public.profiles.theme IS '用户主题偏好：dark | light，默认 dark';
```

> RLS 策略无需修改：`UPDATE` 策略 `auth.uid() = id` 已覆盖此新列。

### 4.2 Go 后端（users 表）

通过 GORM AutoMigrate 自动添加字段（修改 [`model/user.go`](../go-chat-server/model/user.go)）。

---

## 5. 后端变更

### 5.1 Go 后端

| 文件 | 变更 |
|------|------|
| [`model/user.go`](../go-chat-server/model/user.go) | 新增 `Theme string` 字段，json tag `theme`，gorm `type:varchar(10);default:dark` |
| [`service/user.go`](../go-chat-server/service/user.go) | 新增 `UpdateTheme(ctx, userID, theme)` 方法 |
| [`api/user.go`](../go-chat-server/api/user.go) | 新增 `PUT /api/me/theme` 路由处理函数 |

### 5.2 IChatService 接口

在 [`types/index.ts`](../client-chat-tauri/src/types/index.ts) 的 `IChatService` 中新增方法签名：

```ts
/** 更新用户主题偏好，返回更新后的完整 User */
updateTheme(theme: 'dark' | 'light'): Promise<User>
```

### 5.3 Supabase 适配器实现

```ts
async updateTheme(theme: 'dark' | 'light'): Promise<User> {
  const supabase = getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')

  const { data: profile, error } = await supabase
    .from('profiles')
    .update({ theme, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('id, nickname, employee_id, avatar_url, theme')
    .single()

  if (error) throw new Error(`更新主题失败: ${error.message}`)
  return { /* 映射为 User */ }
}
```

### 5.4 Go 适配器实现

```ts
async updateTheme(theme: 'dark' | 'light'): Promise<User> {
  const res = await api.put('/api/me/theme', { theme })
  return res.data
}
```

### 5.5 登录/注册/Session 恢复返回 theme

所有返回 `User` 的地方（`login`、`register`、`restoreSession`）需要在查询 `profiles` 时额外 select `theme` 字段，并映射到 `User` 对象中。

---

## 6. 前端变更

### 6.1 类型系统

[`types/index.ts`](../client-chat-tauri/src/types/index.ts) — `User` 接口新增：

```ts
export interface User {
  // ... 现有字段 ...
  /** 主题偏好 */
  theme?: 'dark' | 'light'
}
```

[`vite-env.d.ts`](../client-chat-tauri/src/vite-env.d.ts) — 无需变更（theme 不是环境变量）。

### 6.2 主题 CSS 文件

#### `themes/tokens.css` — 变量声明（空值占位）

```css
/* 所有主题变量在此声明，具体值由 dark.css / light.css 提供 */
:root {
  --color-bg-deepest: initial;
  --color-bg-deeper: initial;
  --color-bg-default: initial;
  /* ... 全部 token ... */
}
```

#### `themes/dark.css` — 暗色主题值

```css
:root.dark {
  --color-bg-deepest: #0f0f23;
  --color-bg-deeper: #17132b;
  --color-bg-default: #1a1a2e;
  --color-bg-elevated: #1e1935;
  --color-bg-dialog: #141028;
  --color-bg-dialog-input: #0f0b24;
  --color-bg-dialog-deep: #0c0820;
  --color-text-primary: #e2e8f0;
  --color-text-heading: #ffffff;
  --color-text-secondary: #a0aec0;
  --color-text-muted: #718096;
  --color-text-disabled: #4a5568;
  --color-text-dim: #475569;
  --color-border-default: #2d3748;
  --color-border-strong: #2a1f5e;
  --color-border-subtle: rgb(255 255 255 / 0.06);
  --color-hover-bg: rgb(255 255 255 / 0.04);
  --color-hover-strong: rgb(255 255 255 / 0.06);
  --color-hover-weak: rgb(255 255 255 / 0.02);
  --color-active-bg: #252050;
  --color-overlay: rgb(0 0 0 / 0.50);
  --color-overlay-light: rgb(0 0 0 / 0.30);
  --color-input-bg: #17132b;
  --color-input-bg-alt: #1e293b;
  --color-scrollbar-thumb: #2d3748;
}
```

#### `themes/light.css` — 浅色主题值（默认）

```css
:root {
  --color-bg-deepest: #e8ecf1;
  --color-bg-deeper: #f0f2f5;
  --color-bg-default: #f8f9fc;
  --color-bg-elevated: #ffffff;
  --color-bg-dialog: #ffffff;
  --color-bg-dialog-input: #f0f2f5;
  --color-bg-dialog-deep: #e8ecf1;
  --color-text-primary: #1a1a2e;
  --color-text-heading: #111827;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-text-disabled: #d1d5db;
  --color-text-dim: #9ca3af;
  --color-border-default: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-border-subtle: rgb(0 0 0 / 0.06);
  --color-hover-bg: rgb(0 0 0 / 0.04);
  --color-hover-strong: rgb(0 0 0 / 0.06);
  --color-hover-weak: rgb(0 0 0 / 0.02);
  --color-active-bg: #e0e7ff;
  --color-overlay: rgb(0 0 0 / 0.40);
  --color-overlay-light: rgb(0 0 0 / 0.20);
  --color-input-bg: #f0f2f5;
  --color-input-bg-alt: #f0f2f5;
  --color-scrollbar-thumb: #cbd5e1;
}
```

### 6.3 入口挂载

[`main.ts`](../client-chat-tauri/src/main.ts)：

```ts
import './themes/tokens.css'
import './themes/dark.css'
import './themes/light.css'
```

在 `authStore.restoreSession()` 成功后，根据 `currentUser.theme` 设置 `<html>` class：

```ts
// 在 authStore 或 App.vue 中
watch(() => authStore.currentUser?.theme, (theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}, { immediate: true })
```

### 6.4 Store 层

[`stores/auth.ts`](../client-chat-tauri/src/stores/auth.ts) 新增：

```ts
/** 切换主题并持久化 */
async function setTheme(theme: 'dark' | 'light') {
  const user = await chatService.updateTheme(theme)
  if (currentUser.value) {
    currentUser.value = { ...currentUser.value, theme: user.theme }
  }
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
```

### 6.5 UI：个人信息弹窗

在 [`UserProfileDialog.vue`](../client-chat-tauri/src/components/chat/UserProfileDialog.vue) 中新增主题切换区域，放在昵称输入框下方、保存按钮上方：

```vue
<!-- 主题切换 -->
<div class="w-full flex flex-col gap-1.5">
  <label class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">主题</label>
  <div class="flex gap-2">
    <button
      v-for="t in (['dark', 'light'] as const)"
      :key="t"
      class="flex-1 py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer"
      :class="(authStore.currentUser?.theme ?? 'dark') === t
        ? 'border-blue-400 bg-blue-400/10 text-blue-400'
        : 'border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'"
      @click="authStore.setTheme(t)"
    >
      {{ t === 'dark' ? '🌙 深色' : '☀️ 浅色' }}
    </button>
  </div>
</div>
```

---

## 7. 组件迁移清单（逐个替换硬编码颜色）

### 7.1 迁移规则

| 原写法 | 改为 |
|--------|------|
| `bg-[#1a1a2e]` | `bg-[var(--color-bg-default)]` |
| `text-[#e2e8f0]` | `text-[var(--color-text-primary)]` |
| `text-white`（弹窗标题） | `text-[var(--color-text-heading)]` |
| `border-[#2d3748]` | `border-[var(--color-border-default)]` |
| `hover:bg-[#ffffff0a]` | `hover:bg-[var(--color-hover-bg)]` |
| `bg-white/[0.04]` | `bg-[var(--color-hover-bg)]` |
| `border-white/[0.06]` | `border-[var(--color-border-subtle)]` |
| `placeholder:text-[#4a5568]` | `placeholder:text-[var(--color-text-disabled)]` |

### 7.2 文件迁移清单

| # | 文件 | 影响行数（估） | 优先级 |
|---|------|:---:|:---:|
| 1 | [`style.css`](../client-chat-tauri/src/style.css) | ~3 | 🔴 滚动条 |
| 2 | [`Index.vue`](../client-chat-tauri/src/views/chat/Index.vue) | ~3 | 🔴 主背景 |
| 3 | [`Sidebar.vue`](../client-chat-tauri/src/views/chat/Sidebar.vue) | ~5 | 🔴 |
| 4 | [`FriendList.vue`](../client-chat-tauri/src/views/chat/FriendList.vue) | ~20 | 🔴 最多改动 |
| 5 | [`ChatWindow.vue`](../client-chat-tauri/src/views/chat/ChatWindow.vue) | ~25 | 🔴 最多改动 |
| 6 | [`InputArea.vue`](../client-chat-tauri/src/views/chat/InputArea.vue) | ~6 | 🟡 |
| 7 | [`Login.vue`](../client-chat-tauri/src/views/Login.vue) | ~15 | 🟡 |
| 8 | [`TitleBar.vue`](../client-chat-tauri/src/components/TitleBar.vue) | ~4 | 🟡 |
| 9 | [`Avatar.vue`](../client-chat-tauri/src/components/Avatar.vue) | ~3 | 🟢 `<style scoped>` |
| 10 | [`ImagePreview.vue`](../client-chat-tauri/src/components/ImagePreview.vue) | ~1 | 🟢 仅遮罩 |
| 11 | [`Toast.vue`](../client-chat-tauri/src/components/Toast.vue) | ~0 | 🟢 品牌色不变 |
| 12 | [`AddFriendDialog.vue`](../client-chat-tauri/src/components/chat/AddFriendDialog.vue) | ~30 | 🔴 最多改动 |
| 13 | [`CreateGroupDialog.vue`](../client-chat-tauri/src/components/chat/CreateGroupDialog.vue) | ~20 | 🔴 |
| 14 | [`GroupMembersPanel.vue`](../client-chat-tauri/src/components/chat/GroupMembersPanel.vue) | ~20 | 🔴 |
| 15 | [`UserProfileDialog.vue`](../client-chat-tauri/src/components/chat/UserProfileDialog.vue) | ~8 | 🔴 加主题开关 |

> 预估总改动行数：**~160 行**

---

## 8. 实施阶段

### Phase 1：基础设施（预计 1-2 小时）

| 步骤 | 内容 |
|------|------|
| 1.1 | 编写 `docs/10_add_theme_column.sql`，在 Supabase 执行 |
| 1.2 | 修改 `types/index.ts`：`User` 加 `theme`，`IChatService` 加 `updateTheme` |
| 1.3 | 修改 `model/user.go`：加 `Theme` 字段 |
| 1.4 | 修改 `service/user.go`：加 `UpdateTheme` 方法 |
| 1.5 | 修改 `api/user.go`：加 `PUT /api/me/theme` 路由 |
| 1.6 | 修改 `chatService.ts`：Supabase 适配器实现 `updateTheme` + 所有查询加 `theme` 字段 |
| 1.7 | 修改 `goChatService.ts`：Go 适配器实现 `updateTheme` + 所有响应解析 `theme` |

### Phase 2：主题系统（预计 30 分钟）

| 步骤 | 内容 |
|------|------|
| 2.1 | 创建 `themes/tokens.css`、`dark.css`、`light.css` |
| 2.2 | 修改 `main.ts`：import 主题 CSS + 初始 `<html>` class 设置 |
| 2.3 | 修改 `stores/auth.ts`：加 `setTheme` action + 初始化 theme 到 `<html>` class |

### Phase 3：全站颜色迁移（预计 2-3 小时）

按 7.2 节清单逐文件替换，每个文件改完后立即 `npm run dev` 验证暗色主题无回归。

**迁移策略**：按优先级从高到低：
1. 先改核心聊天页面（Index → Sidebar → FriendList → ChatWindow → InputArea）
2. 再改弹窗组件（UserProfileDialog → AddFriendDialog → CreateGroupDialog → GroupMembersPanel）
3. 然后改登录页和基础组件（Login → TitleBar → Avatar → ImagePreview）
4. 最后统一 `custom-scrollbar` 样式

### Phase 4：浅色主题调试（预计 1-2 小时）

| 步骤 | 内容 |
|------|------|
| 4.1 | 在 `UserProfileDialog` 中加主题切换开关 UI |
| 4.2 | 切换到浅色主题，逐页面检查视觉效果 |
| 4.3 | 微调 `light.css` 色值直到满意 |
| 4.4 | 检查 `custom-scrollbar` 在浅色下的可见性 |
| 4.5 | 检查所有弹窗/面板的标题文字可读性 |

---

## 9. 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|:---:|------|
| 替换过程中某处颜色写错 Token 名导致布局错乱 | 🟡 中 | 改完一个文件立即 `npm run dev` 验证 |
| `white/[opacity]` 透明度模式替换遗漏 | 🔴 高 | 替换完成后全项目 `grep` 搜索 `white/\[` 确认无残留 |
| 浅色主题下品牌渐变按钮过于刺眼 | 🟢 低 | 品牌色原则上不变，如需可后续微调 |
| 浅色主题滚动条不可见 | 🟡 中 | Phase 4 专项检查所有 `custom-scrollbar` 实例 |
| Go 后端 GORM AutoMigrate 新增字段失败 | 🟢 低 | 新增字段默认 `dark`，失败不影响现有功能 |
| 首次登录用户 `theme` 为 `undefined` 时默认行为 | 🟢 低 | 代码中统一 `?? 'dark'` 兜底 |

---

## 10. 验收标准

- [ ] 暗色主题：与改造前视觉效果 100% 一致（无回归）
- [ ] 浅色主题：所有页面可读、层次分明
- [ ] 在个人信息弹窗中切换主题，即时生效无需刷新
- [ ] 刷新页面 / 重新登录后主题偏好保持不变
- [ ] Supabase 和 Go 后端两种模式下主题切换均正常工作
- [ ] 弹窗标题文字在浅色主题下清晰可见
- [ ] 滚动条在浅色主题下可见
- [ ] 所有 hover/active 交互效果在浅色下正常
