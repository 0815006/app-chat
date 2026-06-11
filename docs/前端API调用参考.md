# 前端 API 调用参考

> **项目**：app-chat (Tauri 2.x + Vue 3 + TypeScript)  
> **一期后端**：Supabase (本地 Docker 部署)；**二期后端**：Go + Gin + WebSocket（代码已就位，通过 `VITE_BACKEND_TYPE` 环境变量切换）  
> **SDK**：`@supabase/supabase-js` v2.x  
> **配套文档**：[Supabase 运维手册](./Supabase运维手册.md) | [环境搭建与启动指南](./环境搭建与启动指南.md)  
> **配套 SQL**：[01_init_database.sql](./01_init_database.sql) | [02_add_online_status.sql](./02_add_online_status.sql) | [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) | [04_init_storage_buckets.sql](./04_init_storage_buckets.sql)

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
9. [实时消息模块 (Realtime)](#9-实时消息模块-realtime)

---

## 1. 请求链路架构

```
┌──────────────────────────────────────────────────────────┐
│  UI 层 (views/ + components/)                            │
│  ├── Login.vue        ├── ChatWindow.vue                 │
│  ├── InputArea.vue    └── FriendList.vue                 │
│         │                      │                         │
│         ▼                      ▼                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Pinia Store 层 (stores/)                         │  │
│  │  ├── auth.ts:  login / register / logout           │  │
│  │  └── chat.ts:  loadFriends / sendMessage / ...    │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Service 层 (services/chatService.ts)             │  │
│  │  SupabaseChatService implements IChatService       │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Supabase SDK 单例 (utils/supabase.ts)            │  │
│  └───────────────────────┬───────────────────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                            │
                            ▼
    ┌───────────────────────────────────────────────────┐
    │                Supabase 后端服务                   │
    │  ┌──────────┐ ┌───────────┐ ┌────────┐ ┌───────┐ │
    │  │ GoTrue   │ │ PostgREST │ │Storage │ │Real-  │ │
    │  │ (Auth)   │ │ (DB API)  │ │(File)  │ │time   │ │
    │  └──────────┘ └─────┬─────┘ └────────┘ └───────┘ │
    │                     │                              │
    │              ┌──────▼──────┐                       │
    │              │ PostgreSQL  │                       │
    │              └─────────────┘                       │
    └───────────────────────────────────────────────────┘
```

### 文件职责

| 文件 | 职责 |
|------|------|
| [`src/utils/supabase.ts`](../client-chat-tauri/src/utils/supabase.ts) | Supabase 客户端单例 |
| [`src/services/chatService.ts`](../client-chat-tauri/src/services/chatService.ts) | 实现 `IChatService` 接口（Supabase 适配器） |
| [`src/services/goChatService.ts`](../client-chat-tauri/src/services/goChatService.ts) | 实现 `IChatService` 接口（Go 后端适配器） |
| [`src/services/index.ts`](../client-chat-tauri/src/services/index.ts) | 根据 `VITE_BACKEND_TYPE` 选择适配器，导出 `chatService` 单例 |
| [`src/stores/auth.ts`](../client-chat-tauri/src/stores/auth.ts) | 认证状态管理 |
| [`src/stores/chat.ts`](../client-chat-tauri/src/stores/chat.ts) | 聊天状态管理（含在线状态、好友管理） |
| [`src/router/index.ts`](../client-chat-tauri/src/router/index.ts) | 路由守卫鉴权 |

---

## 2. 客户端初始化

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

---

## 3. 认证模块 (Auth)

### 3.1 注册

**调用链路**：`Login.vue` → `authStore.register()` → `chatService.register()`

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

### 3.2 登录

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

### 3.3 登出

```ts
await supabase.auth.signOut()
// → POST /auth/v1/logout
```

### 3.4 恢复会话

```ts
const { data } = await supabase.auth.getSession()
if (!data.session) return null

const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', data.session.user.id)
  .single()
```

### 3.5 路由守卫

[`router/index.ts`](../client-chat-tauri/src/router/index.ts) 中直接调用（避免循环依赖 Store）：
```ts
const { data } = await supabase.auth.getSession()
if (!data.session) return next('/login?redirect=' + to.path)
```

---

## 4. 用户资料模块 (Profiles)

> 对应表：`public.profiles`

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
await supabase
  .from('profiles')
  .select('*')
  .or(`nickname.ilike.%${query}%,employee_id.ilike.%${query}%`)
  .limit(20)
```
- 按昵称或工号模糊搜索（大小写不敏感）
- 最多返回 20 条

### 4.3 更新个人资料

```ts
// 更新昵称
await supabase
  .from('profiles')
  .update({ nickname })
  .eq('id', userId)

// 更新头像 URL（先上传到 Storage）
await supabase
  .from('profiles')
  .update({ avatar_url: publicUrl })
  .eq('id', userId)
```

---

## 5. 聊天消息模块 (Messages)

> 对应表：`public.messages`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 消息唯一标识 |
| `sender_id` | UUID (FK→profiles) | 发送者 |
| `receiver_id` | UUID (FK→profiles) | 接收者 |
| `content` | TEXT | 文本或文件 URL |
| `msg_type` | TEXT | `text` / `image` / `file` / `voice` |
| `is_read` | BOOLEAN | 是否已读 |
| `created_at` | TIMESTAMPTZ | 发送时间 |

### 5.1 获取历史消息

```ts
await supabase
  .from('messages')
  .select('*')
  .or(
    `and(sender_id.eq.${a},receiver_id.eq.${b}),` +
    `and(sender_id.eq.${b},receiver_id.eq.${a})`
  )
  .order('created_at', { ascending: true })
  .limit(100)
```
- 查询双向对话最近 100 条，按时间升序
- 触发时机：`chatStore.setActiveFriend()` 切换好友时

### 5.2 发送消息

```ts
await supabase
  .from('messages')
  .insert({
    content: msgData.content,
    msg_type: msgData.msg_type,
    sender_id: msgData.sender_id,
    receiver_id: msgData.receiver_id,
  })
  .select()
  .single()
// → POST /rest/v1/messages (Prefer: return=representation)
// 返回含服务端生成的 id 和 created_at
```

### 5.3 标记已读

```ts
await supabase
  .from('messages')
  .update({ is_read: true })
  .in('id', messageIds)
// → PATCH /rest/v1/messages?id=in.(...)
```

### 5.4 获取最后一条消息（好友列表摘要）

```ts
await supabase
  .from('messages')
  .select('content, created_at')
  .or(`and(sender_id.eq.${me},receiver_id.eq.${friend}),...`)
  .order('created_at', { ascending: false })
  .limit(1)
```
- 仅取 `content` + `created_at`，降序取最新 1 条

---

## 6. 好友关系模块 (Friendships)

> 对应表：`public.friendships`  
> 好友关系为**双向存储**：A 加 B → 同时写入 `(A, B)` 和 `(B, A)`。  
> **实际实现**：使用 `add_friend()` / `remove_friend()` **RPC 函数**在数据库侧原子性完成双向操作。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 关系 ID |
| `user_id` | UUID (FK→profiles) | 用户 |
| `friend_id` | UUID (FK→profiles) | 好友 |
| `status` | TEXT | `accepted` / `pending` |
| `created_at` | TIMESTAMPTZ | 创建时间 |

### 6.1 获取好友列表

```ts
// 关联查询好友资料（含在线状态）
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

// 再对每个好友查最后一条消息（并发 Promise.all）
```
- PostgREST Resource Embedding 语法关联 `profiles`
- 返回 `Friend` 对象（含在线状态、未读计数、最后消息摘要）

### 6.2 添加好友（RPC 调用）

```ts
// 调用数据库 RPC 函数，原子性完成双向插入
await supabase.rpc('add_friend', { p_friend_id: friendId })
// → POST /rest/v1/rpc/add_friend
// 返回 JSONB: { success: true, friendship: {...} }
```

> `add_friend` RPC 内部自动执行两次 INSERT（`(me, friend)` 和 `(friend, me)`），调用方无需手动处理双向逻辑和事务回滚。

### 6.3 删除好友（RPC 调用）

```ts
await supabase.rpc('remove_friend', { p_friend_id: friendId })
// → POST /rest/v1/rpc/remove_friend
// 内部自动执行两次 DELETE，移除双向记录
```

---

## 7. 在线状态模块 (Online Status)

### 7.1 数据来源

- `profiles.is_online` (BOOLEAN)：由 RPC 函数更新
- `profiles` 表已加入 Realtime 发布，在线状态变更可实时推送

### 7.2 上线

```ts
await supabase.rpc('go_online')
// → POST /rest/v1/rpc/go_online
// SECURITY DEFINER 函数，设置调用者 is_online = true
```

**调用时机**：`chatStore.goOnline()` — 在聊天页面 `onMounted` 中调用

### 7.3 下线

```ts
await supabase.rpc('go_offline')
// → POST /rest/v1/rpc/go_offline
// SECURITY DEFINER 函数，设置调用者 is_online = false
```

**调用时机**：`chatStore.goOffline()` — 在聊天页面 `onUnmounted` 中调用

### 7.4 订阅在线状态变更

```ts
const channel = supabase
  .channel('online-status')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
  }, (payload) => {
    const { id, is_online } = payload.new
    callback({ userId: id, isOnline: is_online })
  })
  .subscribe()

// 取消订阅
return () => { supabase.removeChannel(channel) }
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

> 存储桶由 [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql) 创建。

### 8.2 上传文件

```ts
// 1. 生成路径：{userId}/{timestamp}_{random}.{ext}
const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

// 2. 上传
await supabase.storage.from(bucket).upload(fileName, file, {
  cacheControl: '3600',
  upsert: false,
})
// → POST /storage/v1/object/{bucket}/{path}

// 3. 获取公开 URL
const { data } = supabase.storage.from(bucket).getPublicUrl(fileName)
return data.publicUrl  // 存入 messages.content
```

### 8.3 完整发送文件流程

```
1. uploadFile(file, type) → 获取公开 URL
2. sendMessage(url, type)  → 将 URL 写入 messages 表
```

---

## 9. 实时消息模块 (Realtime)

### 9.1 数据库前置条件

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
```

> 已包含在 [`01_init_database.sql`](./01_init_database.sql) 和 [`02_add_online_status.sql`](./02_add_online_status.sql) 中。

### 9.2 订阅消息变更

```ts
const channel = supabase
  .channel('messages-realtime')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
  }, (payload) => {
    const newMsg = payload.new as Message
    callback(newMsg)
  })
  .subscribe()

// 取消订阅
return () => { supabase.removeChannel(channel) }
```

### 9.3 Store 层回调处理

```
收到新消息 →
├── 匹配当前活跃聊天 → push 到 messages + 标记已读
├── 更新好友列表摘要
└── 该好友移到列表顶部
```

**防重复订阅**：`initRealtimeListener()` 检查 `unsubscribeRealtime` 是否已存在  
**幂等**：push 前 `Array.some()` 检查 id 是否重复  

### 9.4 订阅在线状态变更

```ts
const channel = supabase
  .channel('online-status')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
  }, (payload) => {
    callback({ userId: payload.new.id, isOnline: payload.new.is_online })
  })
  .subscribe()
```

---

## 附录：完整接口清单

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
| 10 | `from('messages').select().or().order()` | `GET /rest/v1/messages` | 历史消息 |
| 11 | `from('messages').insert().select()` | `POST /rest/v1/messages` | 发送消息 |
| 12 | `from('messages').update().in()` | `PATCH /rest/v1/messages` | 标记已读 |
| 13 | `from('friendships').select().eq()` | `GET /rest/v1/friendships` | 好友列表 |
| 14 | `supabase.rpc('add_friend', ...)` | `POST /rest/v1/rpc/add_friend` | 添加好友（RPC） |
| 15 | `supabase.rpc('remove_friend', ...)` | `POST /rest/v1/rpc/remove_friend` | 删除好友（RPC） |
| 16 | `supabase.rpc('go_online')` | `POST /rest/v1/rpc/go_online` | 设置上线 |
| 17 | `supabase.rpc('go_offline')` | `POST /rest/v1/rpc/go_offline` | 设置下线 |
| 18 | `storage.from().upload()` | `POST /storage/v1/object/...` | 上传文件 |
| 19 | `storage.from().getPublicUrl()` | 客户端拼接 | 获取公开 URL |
| 20 | `channel().on().subscribe()` | WebSocket | 实时消息订阅 |
| 21 | `channel().on().subscribe()` | WebSocket | 在线状态订阅 |
| 22 | `removeChannel()` | WebSocket | 取消订阅 |

> **文档维护**：当 `chatService.ts` 中新增 Supabase SDK 调用时，请同步更新本文档。
