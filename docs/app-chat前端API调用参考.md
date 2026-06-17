# 前端 API 调用参考

> **项目**：app-chat (Tauri 2.x + Vue 3 + TypeScript)  
> **一期后端**：Supabase (本地 Docker 部署)；**二期后端**：Go + Gin + WebSocket（通过 `VITE_BACKEND_TYPE` 环境变量切换）  
> **SDK**：`@supabase/supabase-js` v2.x | Go 后端使用 Fetch + 原生 WebSocket  
> **配套文档**：[Supabase 运维手册](./Supabase运维手册.md) | [环境搭建与启动指南](./环境搭建与启动指南.md) | [Go 后端接口对齐图纸](./Go后端接口对齐图纸.md)  
> **配套 SQL**：[01_init_database.sql](./01_init_database.sql) | [02_add_online_status.sql](./02_add_online_status.sql) | [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) | [04_init_storage_buckets.sql](./04_init_storage_buckets.sql) | [08_group_chat.sql](./08_group_chat.sql)

---

## 目录

1. [请求链路架构](#1-请求链路架构)
2. [客户端初始化](#2-客户端初始化)
3. [认证模块 (Auth)](#3-认证模块-auth)
4. [用户资料模块 (Profiles)](#4-用户资料模块-profiles)
5. [聊天消息模块 (Messages)](#5-聊天消息模块-messages)
6. [好友关系模块 (Friendships)](#6-好友关系模块-friendships)
7. [在线状态模块 (Online Status)](#7-在线状态模块-online-status)
8. [文件存储模块 (Storage)](#8-文件存储模块-storage)
9. [实时消息模块 (Realtime / WebSocket)](#9-实时消息模块-realtime--websocket)
10. [群聊模块 (Groups)](#10-群聊模块-groups)
11. [附录：完整接口清单](#11-附录完整接口清单)

---

## 1. 请求链路架构

```
┌──────────────────────────────────────────────────────────────────┐
│  UI 层 (views/ + components/)                                     │
│  ├── Login.vue        ├── ChatWindow.vue    ├── FriendList.vue   │
│  ├── InputArea.vue    ├── Sidebar.vue       └── ...              │
│         │                      │                                  │
│         ▼                      ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Pinia Store 层 (stores/)                                  │  │
│  │  ├── auth.ts:  login / register / logout / restoreSession   │  │
│  │  └── chat.ts:  loadFriends / sendMessage / createGroup / ...│  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Service 层 (services/)                                    │  │
│  │  ┌─────────────────────────┐ ┌───────────────────────────┐ │  │
│  │  │ SupabaseChatService     │ │ GoChatService             │ │  │
│  │  │ (chatService.ts)        │ │ (goChatService.ts)        │ │  │
│  │  └───────────┬─────────────┘ └─────────────┬─────────────┘ │  │
│  └──────────────┼─────────────────────────────┼───────────────┘  │
└─────────────────┼─────────────────────────────┼──────────────────┘
                  │                             │
        ┌─────────▼─────────┐         ┌─────────▼──────────┐
        │  Supabase SDK     │         │  Fetch + WebSocket │
        │ (utils/supabase)  │         │ (goChatService.ts) │
        └─────────┬─────────┘         └─────────┬──────────┘
                  │                             │
                  ▼                             ▼
     ┌───────────────────────┐    ┌──────────────────────────┐
     │   Supabase 后端服务    │    │  Go 后端 (Gin + Melody)  │
     │  ┌───────┐ ┌────────┐ │    │  POST /api/login         │
     │  │GoTrue │ │PostgEST│ │    │  POST /api/register      │
     │  │(Auth) │ │(DB API)│ │    │  GET  /api/history       │
     │  ├───────┤ ├────────┤ │    │  GET  /ws  (WebSocket)   │
     │  │Storage│ │Realtime│ │    │  ...                      │
     │  └───────┘ └────────┘ │    └──────────────────────────┘
     │         PostgreSQL    │
     └───────────────────────┘
```

### 切换机制

前端通过 `VITE_BACKEND_TYPE` 环境变量在编译时静态选择后端：

```ts
// src/services/index.ts
const chatService: IChatService =
  import.meta.env.VITE_BACKEND_TYPE === 'GO'
    ? new GoChatService()
    : new SupabaseChatService()
```

- `VITE_BACKEND_TYPE=SUPABASE`（默认）：使用 Supabase SDK
- `VITE_BACKEND_TYPE=GO`：使用 Fetch + WebSocket 直连 Go 后端

### 文件职责

| 文件 | 职责 |
|------|------|
| [`src/utils/supabase.ts`](../client-chat-tauri/src/utils/supabase.ts) | Supabase 客户端单例 |
| [`src/services/chatService.ts`](../client-chat-tauri/src/services/chatService.ts) | 实现 `IChatService` 接口（Supabase 适配器） |
| [`src/services/goChatService.ts`](../client-chat-tauri/src/services/goChatService.ts) | 实现 `IChatService` 接口（Go 后端适配器） |
| [`src/services/index.ts`](../client-chat-tauri/src/services/index.ts) | 根据 `VITE_BACKEND_TYPE` 选择适配器，导出 `chatService` 单例 |
| [`src/types/index.ts`](../client-chat-tauri/src/types/index.ts) | 核心类型定义 + `IChatService` 接口契约 |
| [`src/stores/auth.ts`](../client-chat-tauri/src/stores/auth.ts) | 认证状态管理 |
| [`src/stores/chat.ts`](../client-chat-tauri/src/stores/chat.ts) | 聊天状态管理（含好友/群组/消息/在线状态/实时监听） |
| [`src/router/index.ts`](../client-chat-tauri/src/router/index.ts) | 路由守卫鉴权 |

---

## 2. 客户端初始化

### 2.1 Supabase 客户端

**位置**：[`client-chat-tauri/src/utils/supabase.ts`](../client-chat-tauri/src/utils/supabase.ts)

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL    // 如 http://127.0.0.1:54321
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: true,  // 自动刷新 JWT
    persistSession: true,    // 持久化到 localStorage
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})
```

- **单例模式**：全局唯一实例，通过 `getSupabase()` 获取
- **环境变量缺失时抛出异常**，阻止应用启动

### 2.2 Go 后端客户端

**位置**：[`client-chat-tauri/src/services/goChatService.ts`](../client-chat-tauri/src/services/goChatService.ts)

```ts
// HTTP 基础地址
private baseUrl(): string {
  return import.meta.env.VITE_GO_BASE_URL || 'http://127.0.0.1:8094'
}

// WebSocket 地址
private wsUrl(): string {
  return import.meta.env.VITE_GO_WS_URL || 'ws://127.0.0.1:8094/ws'
}
```

- Token 存储在 `localStorage` key `go-chat-token`
- HTTP 请求头：`Authorization: Bearer {token}`
- WebSocket 连接：`ws://host/ws?token={JWT_TOKEN}`

---

## 3. 认证模块 (Auth)

### 3.1 注册

**调用链路**：`Login.vue` → `authStore.register()` → `chatService.register()`

#### Supabase 适配器

**步骤一**：Supabase Auth 注册
```ts
const { data, error } = await supabase.auth.signUp({
  email: params.email,
  password: params.password,
})
// → POST /auth/v1/signup
```

**步骤二**：写入 `public.profiles` 表
```ts
await supabase.from('profiles').insert({
  id: data.user.id,
  employee_id: params.employeeId,
  nickname: params.nickname,
})
// → POST /rest/v1/profiles
// 需 RLS: "Users can insert own profile"
```

#### Go 适配器

```ts
const res = await fetch(`${baseUrl}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: params.email,
    password: params.password,
    employee_id: params.employeeId,
    nickname: params.nickname,
  }),
})
// → POST /api/register
// 响应: { code: 200, data: { user: User, token: string } }
```

| 适配器 | 后端 API | 备注 |
|--------|---------|------|
| Supabase | `POST /auth/v1/signup` + `POST /rest/v1/profiles` | 分两步 |
| Go | `POST /api/register` | 一步完成，返回 user + token |

### 3.2 登录

#### Supabase 适配器

```ts
const { data } = await supabase.auth.signInWithPassword({
  email: params.email,
  password: params.password,
})
// → POST /auth/v1/token?grant_type=password

// 然后读取 profiles
const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', data.user.id)
  .single()
```

#### Go 适配器

```ts
const res = await fetch(`${baseUrl}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: params.email, password: params.password }),
})
// → POST /api/login
// 响应: { code: 200, data: { user: User, token: string } }
```

| 适配器 | 后端 API | 备注 |
|--------|---------|------|
| Supabase | `POST /auth/v1/token?grant_type=password` + `GET /rest/v1/profiles` | 分两步 |
| Go | `POST /api/login` | 一步完成，返回 user + token |

### 3.3 登出

```ts
// Supabase
await supabase.auth.signOut()
// → POST /auth/v1/logout

// Go
// 1. 标记离线 (PUT /api/users/offline)
// 2. 关闭 WebSocket 连接
// 3. 清除 localStorage 中的 token
```

> 登出前先调用 `goOffline()` 标记离线，再注销 session（Supabase 场景下顺序重要：signOut 后 `auth.uid()` 不可用）。

### 3.4 恢复会话

#### Supabase 适配器

```ts
const { data } = await supabase.auth.getSession()
if (!data.session) return null

const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', data.session.user.id)
  .single()
```

#### Go 适配器

```ts
const token = localStorage.getItem('go-chat-token')
if (!token) return null

const res = await fetch(`${baseUrl}/api/session`, {
  headers: { Authorization: `Bearer ${token}` },
})
// → GET /api/session
// 响应: { code: 200, data: { user: User } } 或 401（token 无效）
```

| 适配器 | 后端 API | 备注 |
|--------|---------|------|
| Supabase | `GET /auth/v1/session` + `GET /rest/v1/profiles` | |
| Go | `GET /api/session` | ⚠️ 待实现 |

### 3.5 路由守卫

[`router/index.ts`](../client-chat-tauri/src/router/index.ts) 中直接调用（避免循环依赖 Store）：

```ts
// Supabase 模式
const { data } = await supabase.auth.getSession()
if (!data.session) return next('/login?redirect=' + to.path)

// Go 模式：检查 localStorage 中是否有 token，
// 然后调 GET /api/session 验证有效性
```

---

## 4. 用户资料模块 (Profiles)

> Supabase 对应表：`public.profiles`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK, FK→auth.users) | 用户唯一标识 |
| `nickname` | TEXT | 用户昵称 |
| `employee_id` | TEXT | 7 位工号 |
| `avatar_url` | TEXT | 头像 URL |
| `is_online` | BOOLEAN | 是否在线（由 `go_online()` / `go_offline()` RPC 更新） |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

### 4.1 查询单个用户

```ts
// Supabase
await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single()
// → GET /rest/v1/profiles?id=eq.{uuid}&limit=1
```

| 调用场景 | 文件位置 |
|---------|---------|
| 登录时获取用户信息 | `chatService.ts` login() |
| 恢复会话时获取用户信息 | `chatService.ts` restoreSession() |
| 添加好友时获取好友信息 | `chatService.ts` addFriend() |

### 4.2 搜索用户

```ts
// Supabase
await supabase
  .from('profiles')
  .select('id, nickname, employee_id, avatar_url, is_online, created_at')
  .or(`nickname.ilike.%${query}%,employee_id.ilike.%${query}%`)
  .limit(20)

// Go
await fetch(`${baseUrl}/api/users/search?q=${encodeURIComponent(query)}`)
// → GET /api/users/search?q={query}
```
- 按昵称或工号模糊搜索（大小写不敏感）
- 最多返回 20 条
- Go 端响应需包含 `is_online` 字段（从 Redis 查询）

### 4.3 获取所有注册用户

```ts
// Supabase
await supabase
  .from('profiles')
  .select('id, nickname, employee_id, avatar_url, is_online, created_at')
  .order(sortColumn, { ascending })
  .limit(100)

// Go
await fetch(`${baseUrl}/api/users?sort=${sort}`)
// → GET /api/users?sort=created_at|nickname|employee_id
```

### 4.4 更新个人资料

```ts
// Supabase — 更新昵称
await supabase
  .from('profiles')
  .update({ nickname, updated_at: new Date().toISOString() })
  .eq('id', userId)
  .select('id, nickname, employee_id, avatar_url')
  .single()
// → PATCH /rest/v1/profiles?id=eq.{uuid}

// Go
await fetch(`${baseUrl}/api/me`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ nickname }),
})
// → PUT /api/me
```

### 4.5 上传头像

```ts
// Supabase — 上传到 Storage + 更新 profiles
// 1. 上传文件到 chat-files bucket: {userId}/avatars/{timestamp}.{ext}
// 2. 获取公开 URL
// 3. 更新 profiles.avatar_url

// Go
const formData = new FormData()
formData.append('file', file)
await fetch(`${baseUrl}/api/me/avatar`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData,
})
// → POST /api/me/avatar
```

| 限制 | 值 |
|------|-----|
| 最大尺寸 | 5MB |
| 格式 | 仅图片 (`image/*`) |

### 4.6 删除头像

```ts
// Supabase
await supabase
  .from('profiles')
  .update({ avatar_url: null, updated_at: new Date().toISOString() })
  .eq('id', user.id)

// Go
await fetch(`${baseUrl}/api/me/avatar`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
})
// → DELETE /api/me/avatar
```

---

## 5. 聊天消息模块 (Messages)

> Supabase 对应表：`public.messages`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 消息唯一标识 |
| `sender_id` | UUID (FK→profiles) | 发送者 |
| `receiver_id` | UUID (FK→profiles) | 接收者 |
| `group_id` | UUID (FK→groups, NULLABLE) | 群组 ID（群聊时非空） |
| `content` | TEXT | 文本或文件 URL |
| `msg_type` | TEXT | `text` / `image` / `file` / `voice` |
| `is_read` | BOOLEAN | 是否已读 |
| `is_revoked` | BOOLEAN | 是否已撤回 |
| `file_name` | TEXT | 原始文件名（文件/图片/语音类型） |
| `file_size` | BIGINT | 文件字节数（文件/图片/语音类型） |
| `created_at` | TIMESTAMPTZ | 发送时间 |

### 5.1 获取历史消息（游标分页）

```ts
// Supabase
let query = supabase
  .from('messages')
  .select('*')
  .or(
    `and(sender_id.eq.${senderId},receiver_id.eq.${receiverId}),` +
    `and(sender_id.eq.${receiverId},receiver_id.eq.${senderId})`
  )
  .order('created_at', { ascending: false })
  .limit(limit)

if (before) {
  query = query.lt('created_at', before)
}

// Go
const params = new URLSearchParams({ sender_id, receiver_id, limit: String(limit) })
if (before) params.set('before', before)
await fetch(`${baseUrl}/api/history?${params}`)
// → GET /api/history?sender_id={a}&receiver_id={b}&limit=20&before={cursor}
```

| 参数 | 说明 |
|------|------|
| `sender_id` | 当前用户 UUID |
| `receiver_id` | 对话好友 UUID |
| `limit` | 每页条数（默认 20） |
| `before` | 游标：上一页最旧消息的 `created_at`（ISO 字符串），首次加载不传 |

**响应格式**：

```json
{
  "code": 200,
  "data": [ /* Message[] — 按 created_at DESC 返回 */ ],
  "has_more": true
}
```

- 服务端按 `created_at DESC` 返回，FE 调用方做 `reverse()` 变升序
- `has_more`：实际返回数 >= limit 时表示可能还有更多
- 触发时机：`chatStore.setActiveFriend()` 切换好友时（首屏）；`loadMoreHistory()` 滚动到顶时（翻页）

### 5.2 发送消息

```ts
// Supabase
const insertPayload = {
  content: msgData.content,
  msg_type: msgData.msg_type,
  sender_id: msgData.sender_id,
  receiver_id: msgData.receiver_id,
}
// 群聊时附加 group_id
if (msgData.group_id) insertPayload.group_id = msgData.group_id
// 文件消息附加元数据
if (msgData.file_name) insertPayload.file_name = msgData.file_name
if (msgData.file_size !== undefined) insertPayload.file_size = msgData.file_size

await supabase.from('messages').insert(insertPayload).select().single()
// → POST /rest/v1/messages (Prefer: return=representation)

// Go — 优先走 WebSocket
this.ws.send(JSON.stringify({
  type: 'chat',
  sender_id, receiver_id, content, msg_type,
}))

// WebSocket 不可用时退化到 HTTP
await fetch(`${baseUrl}/api/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(msgData),
})
// → POST /api/messages
```

| 适配器 | 后端 API | 备注 |
|--------|---------|------|
| Supabase | `POST /rest/v1/messages` | 返回含服务端 id + created_at |
| Go (WS) | `{ "type": "chat", ... }` | 实时发送，服务端回显确认 |
| Go (HTTP) | `POST /api/messages` | WebSocket 不可用时的退化路径 |

### 5.3 标记已读

```ts
// Supabase
await supabase.from('messages').update({ is_read: true }).in('id', messageIds)
// → PATCH /rest/v1/messages?id=in.(...)

// Go
await fetch(`${baseUrl}/api/messages/read`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ ids: messageIds }),
})
// → POST /api/messages/read
```

### 5.4 撤回消息

```ts
// Supabase
await supabase
  .from('messages')
  .update({
    is_revoked: true,
    content: '[消息已被撤回]',
    msg_type: 'text',
    file_name: null,
    file_size: null,
  })
  .eq('id', messageId)
// → PATCH /rest/v1/messages?id=eq.{messageId}

// Go
await fetch(`${baseUrl}/api/messages/${messageId}/revoke`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
})
// → POST /api/messages/:messageId/revoke
```

**前端撤回逻辑**：
- 仅发送者本人可撤回
- 撤回后服务端更新 `is_revoked=true`，并通过 Realtime / WebSocket 推送 UPDATE 事件
- **发送者侧**：消息保留，显示"你撤回了一条消息"
- **接收者侧**：消息从 UI 列表中移除
- **客户端撤回缓存**：`revokedMessageIds` Set 记录已撤回消息 ID，防止切换聊天对象后因服务端数据延迟导致撤回消息复现

### 5.5 获取最后一条消息（好友列表摘要）

```ts
// Supabase — 对每个好友并发查询
await supabase
  .from('messages')
  .select('content, msg_type, created_at, is_revoked, sender_id')
  .or(`and(sender_id.eq.${me},receiver_id.eq.${friend}),and(sender_id.eq.${friend},receiver_id.eq.${me})`)
  .order('created_at', { ascending: false })
  .limit(1)
```

> Go 端：`GET /api/friends` 返回的 Friend 对象应已包含聚合后的 `last_message`、`last_message_type`、`last_message_at` 字段，前端无需二次查询。

---

## 6. 好友关系模块 (Friendships)

> Supabase 对应表：`public.friendships`  
> 好友关系为**双向存储**：A 加 B → 同时写入 `(A, B)` 和 `(B, A)`。  
> Supabase 实际实现：使用 `add_friend()` / `remove_friend()` **RPC 函数**在数据库侧原子性完成双向操作。  
> Go 实际实现：Service 层事务中手动执行两次 INSERT / DELETE。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 关系 ID |
| `user_id` | UUID (FK→profiles) | 用户 |
| `friend_id` | UUID (FK→profiles) | 好友 |
| `status` | TEXT | `accepted` / `pending` |
| `created_at` | TIMESTAMPTZ | 创建时间 |

### 6.1 获取好友列表

```ts
// Supabase
// 1. 关联查询 friendships + profiles（含在线状态）
await supabase
  .from('friendships')
  .select(`
    id,
    friend_id,
    friend:profiles!friendships_friend_id_fkey (
      id, nickname, employee_id, avatar_url, is_online
    )
  `)
  .eq('user_id', user.id)

// 2. 对每个好友并发查最后一条消息 + 未读计数（Promise.all）

// Go
await fetch(`${baseUrl}/api/friends`, {
  headers: { Authorization: `Bearer ${token}` },
})
// → GET /api/friends
// 响应: { code: 200, data: Friend[] }
```

**返回的 `Friend` 对象包含聚合数据**：

| 字段 | 来源 |
|------|------|
| `friend_id` | friendships 表 |
| `name` | profiles.nickname |
| `employee_id` | profiles.employee_id |
| `avatar_url` | profiles.avatar_url |
| `online` | Redis `online:{friendId}` 或 profiles.is_online |
| `last_message` | messages 表最新一条的 content |
| `last_message_type` | messages 表最新一条的 msg_type |
| `last_message_at` | messages 表最新一条的 created_at |
| `unread_count` | COUNT(messages WHERE sender=friend AND is_read=false AND is_revoked=false) |

### 6.2 添加好友（RPC / 事务）

```ts
// Supabase — RPC 函数原子性双向插入
await supabase.rpc('add_friend', { p_friend_id: friendId })
// → POST /rest/v1/rpc/add_friend
// 返回 JSONB: { id, friend_id, name, employee_id, avatar_url }

// Go — HTTP 接口
await fetch(`${baseUrl}/api/friends`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ friend_id: friendId }),
})
// → POST /api/friends
```

> `add_friend` 内部自动执行双向写入（`(me, friend)` 和 `(friend, me)`），调用方无需手动处理双向逻辑和事务回滚。

> ⚠️ **注意**：Supabase 版直接设为 `accepted`；Go 版当前设为 `pending`。后续需统一为直接 `accepted`（一期没有"好友申请/同意"UI）。

### 6.3 删除好友（RPC / 事务）

```ts
// Supabase — RPC 函数原子性双向删除
await supabase.rpc('remove_friend', { p_friend_id: friendId })
// → POST /rest/v1/rpc/remove_friend

// Go
await fetch(`${baseUrl}/api/friends/${friendId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
})
// → DELETE /api/friends/:friendId
```

> 内部自动执行两次 DELETE，移除双向记录。

---

## 7. 在线状态模块 (Online Status)

### 7.1 数据来源

- **Supabase**：`profiles.is_online` (BOOLEAN) — 由 RPC 函数 `go_online()` / `go_offline()` 更新
- **Go**：Redis `online:{userId}` = "1" — 由 WebSocket connect / disconnect 自动管理
- `profiles` 表（Supabase）/ Redis（Go）变更均可实时推送

### 7.2 上线

```ts
// Supabase
await supabase.rpc('go_online')
// → POST /rest/v1/rpc/go_online
// SECURITY DEFINER 函数，设置调用者 is_online = true

// Go
await fetch(`${baseUrl}/api/users/online`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
})
// → PUT /api/users/online
```

**调用时机**：`chatStore.goOnline()` — 在聊天页面 `onMounted` 中调用

### 7.3 下线

```ts
// Supabase
await supabase.rpc('go_offline')
// → POST /rest/v1/rpc/go_offline

// Go
await fetch(`${baseUrl}/api/users/offline`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
})
// → PUT /api/users/offline
```

**调用时机**：`chatStore.goOffline()` — 在聊天页面 `onUnmounted` 中调用

### 7.4 订阅在线状态变更

#### Supabase 适配器

```ts
const channel = supabase
  .channel('profiles-online-status')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
  }, (payload) => {
    const old = payload.old
    const newRow = payload.new
    // 仅当 is_online 字段变化时回调
    if (old.is_online !== newRow.is_online && newRow.id) {
      callback({ userId: newRow.id, isOnline: newRow.is_online })
    }
  })
  .subscribe()

return () => { supabase.removeChannel(channel) }
```

#### Go 适配器

```ts
// 通过 WebSocket 接收在线状态广播
// 消息类型: "online_status"
// { type: "online_status", user_id: "uuid", is_online: true }
```

**Store 层处理**：`chatStore.initOnlineStatusListener()` 在 `onMounted` 中调用，收到变更后更新好友列表中对应好友的在线状态。

---

## 8. 文件存储模块 (Storage)

### 8.1 存储桶规划

| Bucket | 用途 | 对应 msg_type | 大小限制 |
|--------|------|-------------|---------|
| `chat-images` | 图片 | `image` | 10MB |
| `chat-files` | 文件 | `file` | 50MB |
| `chat-voice` | 语音 | `voice` | 5MB |

> Supabase 存储桶由 [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql) 创建。  
> Go 后端使用本地磁盘 / MinIO / S3，通过 `POST /api/upload` 统一上传。

### 8.2 上传文件

#### Supabase 适配器

```ts
// 1. 客户端文件大小前置校验
const maxSizes = { image: 10MB, file: 50MB, voice: 5MB }

// 2. 生成路径：{userId}/{timestamp}_{random}.{ext}
const fileName = `${params.userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`

// 3. 上传到对应 bucket
await supabase.storage.from(bucket).upload(fileName, file, {
  cacheControl: '3600',
  upsert: false,
})
// → POST /storage/v1/object/{bucket}/{path}

// 4. 获取公开 URL
const { data } = supabase.storage.from(bucket).getPublicUrl(fileName)
return { url: data.publicUrl, file_name: file.name, file_size: file.size }
```

#### Go 适配器

```ts
const formData = new FormData()
formData.append('file', file)
formData.append('user_id', userId)
formData.append('type', type) // 'image' | 'file' | 'voice'

await fetch(`${baseUrl}/api/upload`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData,
})
// → POST /api/upload (multipart/form-data)
// 响应: { code: 200, data: { url, file_name, file_size } }
```

### 8.3 完整发送文件流程

```
1. uploadFile(file, type) → 获取公开 URL + 元数据
2. sendMessage({ content: url, msg_type: type, file_name, file_size }) → 写入 messages 表
```

---

## 9. 实时消息模块 (Realtime / WebSocket)

### 9.1 数据库前置条件（仅 Supabase）

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
```

> 已包含在配套 SQL 文件中。

### 9.2 订阅消息变更

#### Supabase 适配器

```ts
const channel = supabase
  .channel('messages-realtime')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
  }, (payload) => {
    callback(payload.new as Message)
  })
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'messages',
  }, (payload) => {
    // 消息 UPDATE 事件（用于撤回 / 编辑等场景）
    callback(payload.new as Message)
  })
  .subscribe()

return () => { supabase.removeChannel(channel) }
```

#### Go 适配器

```ts
// 建立 WebSocket 连接
this.ws = new WebSocket(`${wsUrl}?token=${token}`)

this.ws.onmessage = (event) => {
  const wsMsg = JSON.parse(event.data)
  // wsMsg.type === 'chat' → 新消息
  // wsMsg.type === 'message_revoke' → 撤回通知
  callback(wsMsg)
}

return () => { this.ws.close() }
```

**WebSocket 消息类型**：

| type | 方向 | 用途 |
|------|------|------|
| `chat` | C↔S | 聊天消息（发送/接收） |
| `typing` | C→S→C | 正在输入通知 |
| `read_receipt` | C→S→C | 已读回执 |
| `heartbeat` | C→S | 心跳 |
| `heartbeat_ack` | S→C | 心跳响应 |
| `online_status` | S→C | 在线状态变更广播 |
| `group_member_join` | S→C | 群成员加入通知 |
| `group_update` | S→C | 群信息更新广播 |
| `message_revoke` | S→C | 消息撤回通知 |

### 9.3 Store 层回调处理

```
收到新消息 (INSERT) →
├── 匹配当前活跃聊天 → push 到 messages + 标记已读
├── 更新好友/群组列表摘要（last_message, last_message_at, unread_count）
├── 该好友/群组移到列表顶部
└── 窗口未聚焦时 → 发送系统通知 + 任务栏闪烁

收到撤回事件 (UPDATE is_revoked=true) →
├── 发送者侧：保留消息，替换为"你撤回了一条消息"
├── 接收者侧：从 messages 列表中移除
└── 写入客户端撤回缓存 (revokedMessageIds)，防止切换对象后复现
```

**防重复订阅**：`initRealtimeListener()` 检查 `unsubscribeRealtime` 是否已存在  
**幂等**：push 前 `Array.some()` 检查 id 是否重复  

---

## 10. 群聊模块 (Groups)

> Supabase 对应表：`public.groups` + `public.group_members`（由 [`08_group_chat.sql`](./08_group_chat.sql) 创建）  
> Go 后端需新建 `groups` 和 `group_members` 表。

### 10.1 群组表结构

#### groups

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 群组唯一标识 |
| `name` | TEXT | 群组名称 |
| `avatar_url` | TEXT | 群头像 URL |
| `owner_id` | UUID (FK→profiles) | 群主 |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

#### group_members

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 成员记录 ID |
| `group_id` | UUID (FK→groups) | 群组 |
| `user_id` | UUID (FK→profiles) | 用户 |
| `role` | TEXT | `owner` / `admin` / `member` |
| `joined_at` | TIMESTAMPTZ | 加入时间 |

### 10.2 创建群组

```ts
// Supabase — RPC 函数
await supabase.rpc('create_group', {
  p_name: name,
  p_member_ids: memberIds,
})
// → POST /rest/v1/rpc/create_group
// 返回 Group 对象

// Go
await fetch(`${baseUrl}/api/groups`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name, member_ids: memberIds }),
})
// → POST /api/groups
```

> 创建群组时同时将群主和成员写入 `group_members` 表。

### 10.3 获取群组列表

```ts
// Supabase — 三步聚合
// 1. 查 group_members WHERE user_id = me → 获取 my groups
// 2. 查 groups WHERE id IN (...) → 群组详情
// 3. 对每个群 Promise.all：查成员数 + 最后一条消息 + 未读计数

// Go
await fetch(`${baseUrl}/api/groups`, {
  headers: { Authorization: `Bearer ${token}` },
})
// → GET /api/groups
```

**返回的 `Group` 对象包含聚合数据**：

| 字段 | 来源 |
|------|------|
| `id` / `name` / `owner_id` / `created_at` | groups 表 |
| `member_count` | COUNT(group_members WHERE group_id) |
| `last_message` / `last_message_type` / `last_message_at` | messages 表最新一条 |
| `unread_count` | COUNT(messages WHERE group_id AND is_read=false AND sender_id≠me AND is_revoked=false) |

### 10.4 获取群历史消息

```ts
// Supabase
await supabase
  .from('messages')
  .select('*')
  .eq('group_id', groupId)
  .order('created_at', { ascending: false })
  .limit(limit)
// 游标翻页: .lt('created_at', before)

// Go
await fetch(`${baseUrl}/api/groups/${groupId}/history?limit=20&before=${cursor}`)
// → GET /api/groups/:groupId/history
```

分页逻辑与私聊 `fetchHistory` 一致（游标分页 + `has_more`）。

### 10.5 获取群成员列表

```ts
// Supabase — 关联查询 profiles
await supabase
  .from('group_members')
  .select(`
    id, group_id, user_id, role, joined_at,
    profile:profiles!group_members_user_id_fkey (
      nickname, employee_id, avatar_url, is_online
    )
  `)
  .eq('group_id', groupId)
  .order('joined_at', { ascending: true })

// Go
await fetch(`${baseUrl}/api/groups/${groupId}/members`)
// → GET /api/groups/:groupId/members
```

### 10.6 拉人进群

```ts
// Supabase — RPC 函数
await supabase.rpc('add_group_member', {
  p_group_id: groupId,
  p_user_id: userId,
})

// Go
await fetch(`${baseUrl}/api/groups/${groupId}/members`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ user_id: userId }),
})
// → POST /api/groups/:groupId/members
```

### 10.7 修改群名

```ts
// Supabase — RPC 函数
await supabase.rpc('update_group_name', {
  p_group_id: groupId,
  p_name: name,
})

// Go
await fetch(`${baseUrl}/api/groups/${groupId}/name`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name }),
})
// → PUT /api/groups/:groupId/name
```

### 10.8 踢人 / 退出群聊

```ts
// Supabase — RPC 函数
await supabase.rpc('remove_group_member', {
  p_group_id: groupId,
  p_user_id: userId,
})

// Go
await fetch(`${baseUrl}/api/groups/${groupId}/members/${userId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
})
// → DELETE /api/groups/:groupId/members/:userId
```

### 10.9 解散群组（仅群主）

```ts
// Supabase — RPC 函数
await supabase.rpc('dissolve_group', { p_group_id: groupId })

// Go
await fetch(`${baseUrl}/api/groups/${groupId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
})
// → DELETE /api/groups/:groupId
```

### 10.10 标记群消息为已读

```ts
// Supabase
await supabase
  .from('messages')
  .update({ is_read: true })
  .eq('group_id', groupId)
  .in('id', messageIds)

// Go
await fetch(`${baseUrl}/api/groups/${groupId}/messages/read`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ ids: messageIds }),
})
// → POST /api/groups/:groupId/messages/read
```

### 10.11 群成员实时感知

```ts
// Supabase — 订阅 group_members 表 INSERT 事件
const channel = supabase
  .channel('group-members-realtime')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'group_members',
  }, (payload) => {
    callback({ groupId: payload.new.group_id, userId: payload.new.user_id })
  })
  .subscribe()

// Go — 监听 WebSocket group_member_join 消息
// { type: "group_member_join", group_id: "uuid", user_id: "uuid" }
```

**Store 层处理**：仅当被邀请的成员是自己时，自动刷新群组列表（`loadGroups()`）。

### 10.12 群信息更新实时同步

```ts
// Supabase — 订阅 groups 表 UPDATE 事件
const channel = supabase
  .channel('group-updates-realtime')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'groups',
  }, (payload) => {
    callback({
      groupId: payload.new.id,
      name: payload.new.name,
      avatar_url: payload.new.avatar_url,
    })
  })
  .subscribe()

// Go — 监听 WebSocket group_update 消息
// { type: "group_update", group_id: "uuid", name: "新群名", avatar_url: "..." }
```

**Store 层处理**：同步更新 `groups` 列表和 `activeGroup` 中的群名/头像。

---

## 11. 附录：完整接口清单

### 11.1 Supabase 适配器接口

| # | SDK 方法 | 后端 API | 用途 |
|---|---------|---------|------|
| 1 | `supabase.auth.signUp()` | `POST /auth/v1/signup` | 注册 |
| 2 | `supabase.auth.signInWithPassword()` | `POST /auth/v1/token?grant_type=password` | 登录 |
| 3 | `supabase.auth.signOut()` | `POST /auth/v1/logout` | 登出 |
| 4 | `supabase.auth.getSession()` | `GET /auth/v1/session` | 恢复/检查会话 |
| 5 | `supabase.auth.getUser()` | `GET /auth/v1/user` | 获取当前用户 |
| 6 | `from('profiles').insert()` | `POST /rest/v1/profiles` | 注册时创建资料 |
| 7 | `from('profiles').select().eq()` | `GET /rest/v1/profiles` | 查询单个用户 |
| 8 | `from('profiles').select().or()` | `GET /rest/v1/profiles` | 搜索用户 |
| 9 | `from('profiles').update().eq()` | `PATCH /rest/v1/profiles` | 更新资料/头像 |
| 10 | `from('messages').select().or().order()` | `GET /rest/v1/messages` | 历史消息（游标分页） |
| 11 | `from('messages').insert().select()` | `POST /rest/v1/messages` | 发送消息 |
| 12 | `from('messages').update().in()` | `PATCH /rest/v1/messages` | 标记已读 |
| 13 | `from('messages').update().eq()` | `PATCH /rest/v1/messages` | 撤回消息 |
| 14 | `from('friendships').select().eq()` | `GET /rest/v1/friendships` | 好友列表（含聚合） |
| 15 | `supabase.rpc('add_friend', ...)` | `POST /rest/v1/rpc/add_friend` | 添加好友（RPC） |
| 16 | `supabase.rpc('remove_friend', ...)` | `POST /rest/v1/rpc/remove_friend` | 删除好友（RPC） |
| 17 | `supabase.rpc('go_online')` | `POST /rest/v1/rpc/go_online` | 设置上线 |
| 18 | `supabase.rpc('go_offline')` | `POST /rest/v1/rpc/go_offline` | 设置下线 |
| 19 | `storage.from().upload()` | `POST /storage/v1/object/...` | 上传文件 |
| 20 | `storage.from().getPublicUrl()` | 客户端拼接 | 获取公开 URL |
| 21 | `channel('...').on().subscribe()` | WebSocket | 实时消息订阅 (INSERT + UPDATE) |
| 22 | `channel('...').on().subscribe()` | WebSocket | 在线状态订阅 (profiles UPDATE) |
| 23 | `removeChannel()` | WebSocket | 取消订阅 |
| 24 | `supabase.rpc('create_group', ...)` | `POST /rest/v1/rpc/create_group` | 创建群组 |
| 25 | `from('group_members').select()` + `from('groups').select()` | `GET /rest/v1/...` | 获取群组列表 |
| 26 | `from('messages').select().eq('group_id')` | `GET /rest/v1/messages` | 群消息历史 |
| 27 | `from('group_members').select()` | `GET /rest/v1/group_members` | 群成员列表 |
| 28 | `supabase.rpc('add_group_member', ...)` | `POST /rest/v1/rpc/add_group_member` | 拉人进群 |
| 29 | `supabase.rpc('update_group_name', ...)` | `POST /rest/v1/rpc/update_group_name` | 修改群名 |
| 30 | `supabase.rpc('remove_group_member', ...)` | `POST /rest/v1/rpc/remove_group_member` | 踢人/退群 |
| 31 | `supabase.rpc('dissolve_group', ...)` | `POST /rest/v1/rpc/dissolve_group` | 解散群组 |
| 32 | `from('messages').update().eq('group_id')` | `PATCH /rest/v1/messages` | 标记群消息已读 |
| 33 | `channel('group-members-realtime')` | WebSocket | 群成员实时感知 |
| 34 | `channel('group-updates-realtime')` | WebSocket | 群信息更新同步 |

### 11.2 Go 后端接口清单

| # | 方法 | 路径 | 用途 | 鉴权 | 状态 |
|---|------|------|------|------|------|
| 1 | `POST` | `/api/register` | 注册 | 无 | ✅ |
| 2 | `POST` | `/api/login` | 登录 | 无 | ✅ |
| 3 | `GET` | `/api/me` | 获取当前用户 | JWT | ✅ |
| 4 | `GET` | `/api/session` | 恢复会话 | JWT | 🔴 |
| 5 | `PUT` | `/api/me` | 更新昵称 | JWT | 🔴 |
| 6 | `POST` | `/api/me/avatar` | 上传头像 | JWT | 🔴 |
| 7 | `DELETE` | `/api/me/avatar` | 删除头像 | JWT | 🔴 |
| 8 | `GET` | `/api/history` | 历史消息（游标分页） | JWT | ⚠️ |
| 9 | `POST` | `/api/messages` | 发送消息 (HTTP 退化) | JWT | 🔴 |
| 10 | `POST` | `/api/messages/read` | 批量标记已读 | JWT | 🔴 |
| 11 | `POST` | `/api/messages/:id/revoke` | 撤回消息 | JWT | 🔴 |
| 12 | `POST` | `/api/upload` | 上传文件 | JWT | 🔴 |
| 13 | `GET` | `/api/users/search` | 搜索用户 | JWT | 🔴 |
| 14 | `GET` | `/api/users` | 所有用户列表 | JWT | 🔴 |
| 15 | `PUT` | `/api/users/online` | 标记上线 | JWT | 🔴 |
| 16 | `PUT` | `/api/users/offline` | 标记离线 | JWT | 🔴 |
| 17 | `GET` | `/api/friends` | 好友列表（含聚合） | JWT | ⚠️ |
| 18 | `POST` | `/api/friends` | 添加好友 | JWT | ⚠️ |
| 19 | `PUT` | `/api/friends/:id` | 同意好友申请 | JWT | ✅ |
| 20 | `DELETE` | `/api/friends/:id` | 删除好友 | JWT | 🔴 |
| 21 | `POST` | `/api/groups` | 创建群组 | JWT | 🔴 |
| 22 | `GET` | `/api/groups` | 群组列表（含聚合） | JWT | 🔴 |
| 23 | `GET` | `/api/groups/:id/history` | 群消息历史 | JWT | 🔴 |
| 24 | `GET` | `/api/groups/:id/members` | 群成员列表 | JWT | 🔴 |
| 25 | `POST` | `/api/groups/:id/members` | 拉人进群 | JWT | 🔴 |
| 26 | `PUT` | `/api/groups/:id/name` | 修改群名 | JWT | 🔴 |
| 27 | `DELETE` | `/api/groups/:id/members/:uid` | 踢人/退群 | JWT | 🔴 |
| 28 | `DELETE` | `/api/groups/:id` | 解散群组 | JWT | 🔴 |
| 29 | `POST` | `/api/groups/:id/messages/read` | 标记群消息已读 | JWT | 🔴 |
| 30 | `GET` | `/ws` | WebSocket 长连接 | Token Query | ✅ |

> **图例**：✅ 已实现 | ⚠️ 已实现但参数/响应需修正 | 🔴 待实现  
> 详细差异分析参见：[Go 后端接口对齐图纸](./Go后端接口对齐图纸.md)

---

> **文档维护**：当 `chatService.ts` 或 `goChatService.ts` 中新增方法时，请同步更新本文档对应模块及附录清单。
