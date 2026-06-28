# 未读消息浮动气泡快速定位 — 实现计划

> 版本：v1.0  
> 日期：2026-06-28  
> 状态：📋 计划中（尚未开始编码）  
> 参考规范：微信桌面版未读消息定位交互

---

## 1. 功能目标

当用户打开一个存在大量未读消息的聊天（好友私聊或群聊）时：

| 序号 | 行为 | 预期效果 |
|------|------|----------|
| F1 | 进入聊天时，**滚到底部**展示最新消息（微信模式） | 最新消息出现在底部，气泡悬浮供向上定位 |
| F2 | 在聊天窗口**偏上方**显示浮动气泡 | 文案：「N 条新消息」，圆角胶囊形状，居中或偏上浮动 |
| F3 | 点击气泡，**平滑滚动**回第一条未读消息处 | `scroll-behavior: smooth`，`scroll-margin-top: 80px` |
| F4 | 用户向下滚动到底部附近（<120px），气泡自动消失并标记已读 | 与微信行为一致：只有滚到底才算"看完" |
| F5 | 用户正在查看未读区域期间，**新消息到达**时气泡数字自增 | 实时联动 Realtime 监听 |
| F6 | 未读数 = 0 时，完全保持现有滚底行为，不显示气泡 | 向后兼容 |

---

## 2. 现状分析

### 2.1 当前消息加载流程

```
用户点击好友/群组
  → Store.setActiveFriend / setActiveGroup
    → loadHistory(friendId, PAGE_SIZE=20)  /  loadGroupHistory(groupId, PAGE_SIZE=20)
      → 只拉取最近 20 条
      → messages.value = filtered（整体替换）
      → 批量 markAsRead(unreadIds)（立即标记已读）
    → ChatWindow.watch 检测到 messages.length 变化
      → containerRef.scrollTop = containerRef.scrollHeight（无条件滚底）
```

**三处关键代码位置**：

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| ① | `stores/chat.ts` | `loadHistory()` L332-379 | 好友历史加载 + 立即 markAsRead |
| ② | `stores/chat.ts` | `loadGroupHistory()` L428-462 | 群组历史加载 + 立即 markGroupMessagesAsRead |
| ③ | `views/chat/ChatWindow.vue` | watch L422-433 | 切换/ch 新消息 → 无条件滚底 |

### 2.2 核心障碍

- **障碍 1**：`loadHistory` 中一旦调用 `markAsRead`，`is_read` 字段永久变为 `true`，无法在消息数组层面区分"哪条是第一条未读"。
- **障碍 2**：每次只加载固定 20 条消息。如果未读数 > 20，第一条未读消息根本不在当前数组中（还在服务端）。
- **障碍 3**：ChatWindow 的 watch 没有任何未读定位分支，永远滚底。

### 2.3 可用数据

- `friend.unread_count` — 未读消息总数（Realtime 监听累加得出）
- `group.unread_count` — 群未读消息总数
- `message.is_read` — 服务端已读标记（进入聊天即被覆盖为 `true`）

---

## 3. 方案设计

### 3.1 核心策略：快照驱动定位

**不在 `loadHistory` 时立即 `markAsRead`。** 改为：

1. **快照**：在调用 `fetchHistory` 之前，从 `friend.unread_count` / `group.unread_count` 读取未读数快照，存入新状态 `snapshotUnreadCount`。
2. **加量加载**：若快照未读数 > 20（默认 PAGE_SIZE），加载 `max(PAGE_SIZE, unreadCount + 10)` 条，上限 100 条。这样确保第一条未读消息一定在数组中。
3. **定位**：在消息数组尾部倒数 `snapshotUnreadCount` 条处，即为第一条未读消息。用该消息 ID 标记 `firstUnreadMessageId`。
4. **延迟已读**：用户滚动经过未读区域时才调用 `markAsRead`（而非进入聊天时立即标记）。

### 3.2 数据流图

```
用户点击好友 "Alice"（unread_count = 35）
          │
          ▼
setActiveFriend("Alice")
  ├── snapshot = friend.unread_count   // 35
  ├── snapshotUnreadCount = 35
  ├── fetchHistory(sender, receiver, limit=45)
  │       └── 返回最近 45 条消息
  ├── 定位第一条未读 = messages[45-35] = messages[10]
  ├── firstUnreadMessageId = messages[10].id
  ├── showUnreadBubble = true
  │
  ▼
ChatWindow 渲染完成
  └── scrollToFirstUnread(message[10])
        └── el.scrollIntoView({ block: 'start' })
        └── el.scrollTop -= 80（视觉偏移）
```

### 3.3 加量加载算法

```
function calcLoadLimit(unreadCount: number): number {
  if (unreadCount <= 0)            return PAGE_SIZE      // 20 — 未读为空，正常加载
  if (unreadCount <= 20)           return PAGE_SIZE      // 20 — 未读 ≤ 一屏，正常加载覆盖
  if (unreadCount <= 80)           return unreadCount + 10  // 30~90 — 加少量冗余
  return 100                                            // 100 — 上限，避免一次拉太多
}
```

---

## 4. 详细改动清单

### 4.1 `stores/chat.ts` — 新增状态与方法

#### 4.1.1 新增响应式状态

```ts
// ========== 未读浮动气泡 ==========

/** 进入聊天时的未读数快照（不清零，用于气泡显示） */
const snapshotUnreadCount = ref(0)

/** 当前聊天中第一条未读消息的 ID（用于 scrollIntoView 定位） */
const firstUnreadMessageId = ref<string | null>(null)

/** 气泡是否可见 */
const showUnreadBubble = ref(false)
```

#### 4.1.2 新增方法

```ts
/**
 * 跳转到第一条未读消息（由 ChatWindow 调用）
 * 使用 scroll-margin-top 在消息元素上预留 80px 视觉偏移
 */
function jumpToFirstUnread(containerEl: HTMLElement) {
  if (!firstUnreadMessageId.value) return
  const el = containerEl.querySelector(`[data-msg-id="${firstUnreadMessageId.value}"]`)
  if (!el) {
    // 若 DOM 中找不到（消息不在视口附近），手动计算 scrollTop
    // 遍历 displayMessages 找到对应索引，按比例估算位置
    containerEl.scrollTop = containerEl.scrollHeight * 0.3  // fallback
    return
  }
  el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  // scrollIntoView 后微调 80px
  containerEl.scrollTop -= 80
}

/**
 * 隐藏气泡并重置未读快照（用户滚动到底部后调用）
 */
function dismissUnreadBubble() {
  showUnreadBubble.value = false
  snapshotUnreadCount.value = 0
  firstUnreadMessageId.value = null
}

/**
 * 计算加载历史消息时应使用的 limit
 */
function calcLoadLimit(unreadCount: number): number {
  if (unreadCount <= 0)  return 20
  if (unreadCount <= 20) return 20
  if (unreadCount <= 80) return unreadCount + 10
  return 100
}
```

#### 4.1.3 修改 `loadHistory()`（好友历史）

**原有逻辑**：
1. `fetchHistory(..., PAGE_SIZE)` → 固定 20
2. 遍历 history → 过滤撤回 → `messages.value = filtered`
3. 立即 `markAsRead(unreadIds)`

**修改后**：

```
loadHistory(friendId):
  // Step 0: 快照未读数
  const unread = activeFriend.value?.unread_count ?? 0
  snapshotUnreadCount = unread

  // Step 1: 使用加量 limit
  const limit = calcLoadLimit(unread)
  const [history, more] = await fetchHistory(me, friendId, limit)

  // Step 2: 撤回过滤（同现有逻辑）
  messages.value = filteredHistory

  // Step 3: 计算第一条未读位置
  if (unread > 0 && unread <= messages.value.length) {
    const firstIdx = messages.value.length - unread
    firstUnreadMessageId = messages.value[firstIdx].id
    showUnreadBubble = true
  } else if (unread > messages.value.length) {
    // 未读数超过加载上限（100），定位在最旧一条
    firstUnreadMessageId = messages.value[0]?.id ?? null
    showUnreadBubble = true
    // 气泡文案会显示「N 条新消息（仅显示最近部分）」
  }

  // Step 4: 延迟标记已读 — ChatWindow 的 onScroll() 中处理
  // （原 markAsRead 移入 onScroll 逻辑，在用户滚动经过未读区域时调用）

  // Step 5: 返回给 ChatWindow 的滚动标记
  // 由 ChatWindow 的 watch 判断：
  //   if snapshotUnreadCount > 0 → 滚动到 firstUnreadMessageId 处
  //   else → 滚底（原有行为）
```

**`markAsRead` 的迁移**：将原本在 `loadHistory` 末尾的 `markAsRead` 调用移到 `ChatWindow.onScroll` 中。当用户滚动使第一条未读消息的顶部进入视口时，批量标记所有 `messages` 中 `sender_id !== me && !is_read` 的消息为已读。

> **性能注意**：markAsRead 批量调用只执行一次（设置一个 `_markedAsRead` 标志位防止重复调用）。

#### 4.1.4 修改 `loadGroupHistory()`（群组历史）

逻辑完全同 4.1.3，只是操作对象换成 `activeGroup`。从 `activeGroup.unread_count` 快照。

#### 4.1.5 修改 Realtime 回调（`initRealtimeListener`）

在 `subscribeToMessages` 的回调中，当新消息到达且气泡可见时：

```ts
// 非当前活跃聊天 → unread_count++ （现有逻辑保持不变）
// 当前活跃聊天 + 气泡可见 → snapshotUnreadCount++
if (isCurrentChat && showUnreadBubble.value) {
  snapshotUnreadCount.value++
}
// 当前活跃聊天 + 气泡已消失（用户在底部）→ 新消息自动触发滚底（现有逻辑）
```

同时处理撤回减数：
```ts
if (newMsg.is_revoked && showUnreadBubble.value && snapshotUnreadCount.value > 0) {
  snapshotUnreadCount.value--
  if (snapshotUnreadCount.value <= 0) {
    dismissUnreadBubble()
  }
}
```

### 4.2 `views/chat/ChatWindow.vue` — 滚动 + 气泡 UI

#### 4.2.1 修改滚动 watch

```ts
// 原 watch（L422-433）替换为：
watch(
  () => [chatStore.activeFriendId, chatStore.activeGroupId, chatStore.messages.length] as const,
  async (_new, _old) => {
    if (isPullingMore.value) return
    await nextTick()
    if (!containerRef.value) return

    if (chatStore.snapshotUnreadCount > 0 && chatStore.firstUnreadMessageId) {
      // 有未读 → 定位到第一条未读
      chatStore.jumpToFirstUnread(containerRef.value)
    } else {
      // 无未读 → 滚底（原有行为）
      containerRef.value.scrollTop = containerRef.value.scrollHeight
    }
  }
)
```

#### 4.2.2 修改 `onScroll()`

```ts
function onScroll() {
  if (!containerRef.value) return
  const el = containerRef.value

  // ---- 现有：加载更多 ----
  if (el.scrollTop <= 60 && !isPullingMore.value && chatStore.hasMore && !chatStore.isLoadingMore) {
    pullMoreHistory()
  }

  // ---- 新增：未读气泡显隐 ----
  if (chatStore.showUnreadBubble && chatStore.firstUnreadMessageId) {
    const targetEl = el.querySelector(
      `[data-msg-id="${chatStore.firstUnreadMessageId}"]`
    ) as HTMLElement | null

    if (targetEl) {
      const containerRect = el.getBoundingClientRect()
      const targetRect = targetEl.getBoundingClientRect()
      // 如果第一条未读消息的顶部已经滚出容器可视区上方 → 显示气泡
      if (targetRect.bottom < containerRect.top) {
        // 气泡已处于 visible，不需要额外操作
      }
      // 如果第一条未读消息已经在视口内（已看到）→ 隐藏气泡
      else if (targetRect.top >= containerRect.top && targetRect.bottom <= containerRect.bottom) {
        chatStore.dismissUnreadBubble()
      }
    }
  }

  // ---- 新增：滚动到底部自动消失 ----
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6
  if (atBottom && chatStore.showUnreadBubble) {
    chatStore.dismissUnreadBubble()
  }
}
```

#### 4.2.3 新增悬浮气泡 UI

在 `containerRef` 的 `<div>` 内部、消息列表之前插入：

```html
<!-- 未读消息浮动气泡 -->
<Transition name="bubble-fade">
  <div
    v-if="chatStore.showUnreadBubble"
    class="sticky top-3 z-20 flex justify-center pointer-events-none"
  >
    <button
      class="pointer-events-auto flex items-center gap-1.5 px-4 py-1.5
             bg-[var(--color-accent)] text-white text-[13px] font-medium
             rounded-full shadow-lg shadow-black/25
             hover:bg-[var(--color-accent-hover)] active:scale-95
             transition-all duration-200 cursor-pointer"
      @click.stop="chatStore.jumpToFirstUnread(containerRef!)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-3.5 h-3.5">
        <polyline points="6 9 12 15 18 9" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>{{ chatStore.snapshotUnreadCount }} 条新消息</span>
    </button>
  </div>
</Transition>
```

> **样式说明**：
> - `sticky top-3`：在滚动容器内 sticky 定位，距顶部 12px
> - `pointer-events-none` 在外层容器上防止遮挡消息点击，`pointer-events-auto` 在按钮上恢复可点击
> - Transition 用于入场/退场动画

#### 4.2.4 为消息元素添加 `data-msg-id` 属性

在消息气泡的根 `<div>` 上添加：

```html
<div
  v-else
  :key="item.id"
  :data-msg-id="item.id"
  class="flex gap-3 max-w-[75%] mb-0.5 scroll-mt-20"
  ...
>
```

> `scroll-mt-20` = `scroll-margin-top: 5rem`（80px），使 `scrollIntoView` 时在消息上方留出 80px 空间，避免消息紧贴顶栏。

---

## 5. 边界条件处理

| 场景 | 处理策略 |
|------|----------|
| **未读数 = 0** | `snapshotUnreadCount` 为 0，`showUnreadBubble` 为 false，ChatWindow watch 走 else 分支滚底。完全等同现有行为。 |
| **未读数 ≤ 20** | 正常加载 20 条覆盖所有未读。`firstUnreadMessageId = messages[messages.length - unread]`。气泡显示。 |
| **未读数 21~80** | 加载 `unread + 10` 条。精确覆盖且有余量。 |
| **未读数 > 100** | 加载 100 条（上限）。`firstUnreadMessageId` 设为 `messages[0]`。气泡文案可改为「99+ 条新消息（仅显示最近部分）」或保持显示快照数。 |
| **切换聊天** | `setActiveFriend` / `setActiveGroup` 中先调用 `dismissUnreadBubble()` 重置状态。 |
| **打开聊天期间收到新消息** | Realtime 回调中：若 `showUnreadBubble` 为 true，`snapshotUnreadCount++`。若气泡已消失（用户在底部），正常滚底。 |
| **对方撤回未读消息** | Realtime 回调中 `snapshotUnreadCount--`。若归零则关闭气泡。 |
| **用户手动滚到底部** | `onScroll` 检测到 atBottom → `dismissUnreadBubble()`。 |
| **用户切换好友后立刻点回** | 未读数在 `setActiveFriend` 时清 0（`found.unread_count = 0`），所以回到同一好友时气泡不会再出现。符合微信行为。 |
| **滚动加载更多历史** | `pullMoreHistory` 中 `isPullingMore = true` 会跳过自动滚底 watch。加载完不重新触发定位（保持用户当前滚动位置）。 |

---

## 6. 气泡显隐状态机

```
                  ┌───────────────────────────────────────┐
                  │                                       │
                  ▼                                       │
  ┌─────────┐  enter chat   ┌───────────┐  scroll past   ┌──────────┐
  │ HIDDEN  │ ────────────► │  VISIBLE  │ ─────────────► │ DISMISSED│
  │         │  (unread>0)   │           │  (scrolled      │          │
  └─────────┘               └───────────┘   past unread)  └──────────┘
       ▲                          │  ▲                         │
       │                          │  │                         │
       │     switch friend        │  │ new msg arrives          │
       │     (unread=0)           │  │ (snapshot++)             │
       │                          │  │                         │
       └──────────────────────────┘  └─────────────────────────┘
```

- **HIDDEN**：`showUnreadBubble = false`，未读数快照 = 0
- **VISIBLE**：`showUnreadBubble = true`，气泡渲染在消息区顶部
- **DISMISSED**：等同 HIDDEN，由 `dismissUnreadBubble()` 统一设置

---

## 7. 实现步骤（执行顺序）

| 序号 | 模块 | 改动 | 预计行数 |
|------|------|------|----------|
| P1 | `stores/chat.ts` | 新增 `snapshotUnreadCount`、`firstUnreadMessageId`、`showUnreadBubble` 状态 | +6 |
| P2 | `stores/chat.ts` | 新增 `jumpToFirstUnread()`、`dismissUnreadBubble()`、`calcLoadLimit()` | +35 |
| P3 | `stores/chat.ts` | 修改 `loadHistory()`：加量加载 + 未读定位 + 延迟 markAsRead | ~30 |
| P4 | `stores/chat.ts` | 修改 `loadGroupHistory()`：同步 P3 逻辑 | ~30 |
| P5 | `stores/chat.ts` | 修改 `initRealtimeListener` 回调：气泡可见时新消息自增、撤回自减 | +15 |
| P6 | `stores/chat.ts` | 修改 `setActiveFriend` / `setActiveGroup`：入口处重置未读气泡状态 | +4 |
| P7 | `stores/chat.ts` | 导出新增的 state 和方法（return 块） | +5 |
| P8 | `views/chat/ChatWindow.vue` | 修改滚动 watch：有未读 → 定位，无未读 → 滚底 | ~10 |
| P9 | `views/chat/ChatWindow.vue` | 修改 `onScroll`：气泡显隐判断 + 延迟 markAsRead | +20 |
| P10 | `views/chat/ChatWindow.vue` | 消息元素添加 `data-msg-id` + `scroll-mt-20` | +1 |
| P11 | `views/chat/ChatWindow.vue` | 插入气泡 UI（Template 中 sticky div） | +20 |
| P12 | `views/chat/ChatWindow.vue` | 添加 Transition CSS 动画 | +15 |

> 预计总改动量：~200 行（含注释），不涉及新文件创建，不涉及后端/数据库改动。

---

## 8. 测试场景清单

- [ ] `T1`：未读数 = 0，进入聊天 → 滚底，无气泡
- [ ] `T2`：未读数 ≤ 20，进入聊天 → 定位第一条未读，气泡显示正确数字
- [ ] `T3`：未读数 = 35，进入聊天 → 加载 45 条，定位到第 10 条，气泡显示 "35 条新消息"
- [ ] `T4`：未读数 > 100，进入聊天 → 加载 100 条，气泡显示快照数字（或 "99+"）
- [ ] `T5`：气泡可见时，点击气泡 → 平滑滚动回第一条未读处
- [ ] `T6`：气泡可见时，手动滚到底部 → 气泡消失
- [ ] `T7`：气泡可见时，对方发来新消息 → 气泡数字 +1
- [ ] `T8`：气泡可见时，对方撤回消息 → 气泡数字 -1（若归零则消失）
- [ ] `T9`：气泡消失后（用户在看最新消息），对方发新消息 → 正常滚底，不重现气泡
- [ ] `T10`：切换好友 A → 好友 B → 好友 A → 好友 A 未读数已清 0，气泡不再出现
- [ ] `T11`：群聊场景全部 T1~T10
- [ ] `T12`：进入未读聊天后，滚动加载更多历史（顶部），不触发滚底
- [ ] `T13`：窗口 resize 后气泡位置仍正确（sticky 自带）
- [ ] `T14`：`loadHistory` 不再在加载时调用 `markAsRead`，改为 onScroll 中延迟调用
