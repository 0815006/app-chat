# Go 后端接口对齐图纸

> **目的**：记录 Go 后端 HTTP / WebSocket 接口与前端 `IChatService` → `goChatService.ts` 的完整实现状态与对齐情况。
>
> **配套文档**：[前端API调用参考.md](./前端API调用参考.md) | [Supabase运维手册.md](./Supabase运维手册.md)
>
> **最后更新**：2026-06-13（群组 API 前端适配完成）

---

## 目录

1. [Go 后端完整路由清单](#1-go-后端完整路由清单)
2. [数据模型对照](#2-数据模型对照)
3. [HTTP 接口逐项对齐](#3-http-接口逐项对齐)
4. [WebSocket 协议](#4-websocket-协议)
5. [前端 goChatService.ts 实现状态](#5-前端-gochatservicets-实现状态)
6. [路由守卫与鉴权](#6-路由守卫与鉴权)
7. [剩余待办](#7-剩余待办)

---

## 1. Go 后端完整路由清单

> 路由注册在 [`go-chat-server/initialize/router.go`](../go-chat-server/initialize/router.go)

### 1.1 公开 API（无需鉴权）

| 方法 | 路径 | Handler | 状态 |
|------|------|---------|------|
| `GET` | `/api/ping` | 内联 | ✅ |
| `POST` | `/api/register` | `api.Register` | ✅ |
| `POST` | `/api/login` | `api.Login` | ✅ |

### 1.2 需 JWT 鉴权的 API

| 方法 | 路径 | Handler | 状态 |
|------|------|---------|------|
| **会话** | | | |
| `GET` | `/api/session` | `api.RecoverSession` | ✅ |
| **个人资料** | | | |
| `GET` | `/api/me` | `api.GetMe` | ✅ |
| `PUT` | `/api/me` | `api.UpdateMe` | ✅ |
| `POST` | `/api/me/avatar` | `api.UploadAvatar` | ✅ |
| `DELETE` | `/api/me/avatar` | `api.DeleteAvatar` | ✅ |
| **好友管理** | | | |
| `GET` | `/api/friends` | `api.ListFriends` | ✅ |
| `POST` | `/api/friends` | `api.AddFriend` | ✅ |
| `PUT` | `/api/friends/:id` | `api.UpdateFriendStatus` | ✅ |
| `DELETE` | `/api/friends/:friendId` | `api.DeleteFriend` | ✅ |
| **私聊消息** | | | |
| `GET` | `/api/history` | `api.GetHistory` | ✅ 游标分页 |
| `POST` | `/api/messages` | `api.SendMessageHTTP` | ✅ HTTP 退化路径 |
| `POST` | `/api/messages/read` | `api.BatchMarkRead` | ✅ |
| `POST` | `/api/messages/:messageId/revoke` | `api.RevokeMessage` | ✅ |
| **文件上传** | | | |
| `POST` | `/api/upload` | `api.UploadFile` | ✅ |
| **用户搜索** | | | |
| `GET` | `/api/users/search?q=` | `api.SearchUsers` | ✅ |
| `GET` | `/api/users?sort=` | `api.ListUsers` | ✅ |
| **在线状态** | | | |
| `PUT` | `/api/users/online` | `api.MarkOnline` | ✅ |
| `PUT` | `/api/users/offline` | `api.MarkOffline` | ✅ |
| **群组管理** | | | |
| `POST` | `/api/groups` | `api.CreateGroup` | ✅ |
| `GET` | `/api/groups` | `api.ListGroups` | ✅ 聚合响应 |
| `GET` | `/api/groups/:groupId/history` | `api.GetGroupHistory` | ✅ 游标分页 |
| `GET` | `/api/groups/:groupId/members` | `api.GetGroupMembers` | ✅ |
| `POST` | `/api/groups/:groupId/members` | `api.AddGroupMember` | ✅ |
| `PUT` | `/api/groups/:groupId/name` | `api.UpdateGroupName` | ✅ |
| `DELETE` | `/api/groups/:groupId/members/:userId` | `api.RemoveGroupMember` | ✅ |
| `DELETE` | `/api/groups/:groupId` | `api.DissolveGroup` | ✅ |
| `POST` | `/api/groups/:groupId/messages/read` | `api.MarkGroupMessagesRead` | ✅ |

### 1.3 WebSocket

| 路径 | Handler | 鉴权 | 状态 |
|------|---------|------|------|
| `GET /ws?token={JWT}` | `im.Manager.HandleWebSocketGin` | Query Token | ✅ |

---

## 2. 数据模型对照

### 2.1 User（用户）

| Go Model (`model.User`) | 前端 `User` | 对齐 |
|-------------------------|------------|------|
| `id` (varchar 36) | `id: string` | ✅ |
| `nickname` (varchar 100) | `nickname: string` | ✅ |
| `email` (varchar 255) | `email?: string` | ✅ |
| `password` (json:"-") | ❌ 不存在 | ✅ 已隐藏 |
| `employee_id` (varchar 10) | `employee_id: string` | ✅ |
| `avatar_url` (varchar 500) | `avatar_url?: string` | ✅ |
| `created_at` (autoCreateTime) | `created_at?: string` | ✅ |
| `updated_at` (autoUpdateTime) | ❌ | ✅ 无害 |

> **在线状态**：`is_online` 不由 User 表存储，而是由 `im.Manager` 通过 WebSocket 连接/断开 + Redis 管理，通过 WebSocket `online_status` 消息广播给好友。前端 `Friend.online` 由 `ListFriends` 聚合响应动态填充（调用 `OnlineService.IsOnline()`）。

### 2.2 Message（消息）

| Go Model (`model.Message`) | 前端 `Message` | 对齐 |
|----------------------------|---------------|------|
| `id` (varchar 36) | `id: string` | ✅ |
| `sender_id` (varchar 36) | `sender_id: string` | ✅ |
| `receiver_id` (varchar 36) | `receiver_id: string` | ✅ |
| `group_id` (varchar 36) | `group_id?: string` | ✅ |
| `content` (text) | `content: string` | ✅ |
| `msg_type` (varchar 20) | `msg_type: 'text' \| 'image' \| 'file' \| 'voice'` | ✅ |
| `is_read` (bool) | `is_read?: boolean` | ✅ |
| `is_revoked` (bool) | `is_revoked?: boolean` | ✅ |
| `file_name` (varchar 500) | `file_name?: string` | ✅ |
| `file_size` (int64) | `file_size?: number` | ✅ |
| `created_at` (autoCreateTime) | `created_at: string` | ✅ |

> **全字段已对齐。** Go 的 `Sender *User` 和 `Receiver *User` 关联仅用于内部查询，序列化时通过 `omitempty` 省略。

### 2.3 Friend（好友聚合响应）

Go 后端不直接返回 `Friendship`，而是返回 `FriendResponse` 聚合结构：

| Go `FriendResponse` | 前端 `Friend` | 对齐 |
|---------------------|--------------|------|
| `id` | `id: string` | ✅ |
| `friend_id` | `friend_id: string` | ✅ |
| `name` | `name: string` | ✅ (好友昵称) |
| `employee_id` | `employee_id?: string` | ✅ |
| `avatar_url` | `avatar_url?: string` | ✅ |
| `online` | `online?: boolean` | ✅ (Redis/内存动态查询) |
| `last_message` | `last_message?: string` | ✅ |
| `last_message_type` | `last_message_type?: Message['msg_type']` | ✅ |
| `last_message_at` | `last_message_at?: string` | ✅ |
| `unread_count` | `unread_count?: number` | ✅ |

> **全字段已对齐。** `ListFriends` / `AddFriend` 均返回 `FriendResponse`，前端直接 `as Friend[]`。

### 2.4 Group / GroupMember（群组）

| Go Type | 前端 Type | 对齐 |
|---------|----------|------|
| `model.Group` | `Group` | ✅ id, name, avatar_url, owner_id, created_at |
| `model.GroupResponse` | `Group` (含聚合) | ✅ member_count, last_message, last_message_type, last_message_at, unread_count |
| `model.GroupMember` | `GroupMember` | ✅ 含 Preload User (nickname, avatar_url, employee_id) |

> `fetchGroupMembers` 返回的 Go `GroupMember` 含嵌套 `User`，前端 `goChatService.ts` 做扁平化映射 → `{ nickname, avatar_url, employee_id, is_online: false }`。

---

## 3. HTTP 接口逐项对齐

### 3.1 认证与会话

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `POST /api/login` | 返回 `{user, token}` | 提取 `json.data.user` + `json.data.token`，写 localStorage | ✅ |
| `POST /api/register` | 返回 `{user, token}` | 提取 `json.data.user` + `json.data.token`，写 localStorage | ✅ |
| `GET /api/session` | 返回 User 直接在 `data` 字段 | 直接 `json.data as User` | ✅ |

### 3.2 好友管理

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `GET /api/friends` | 返回 `FriendResponse[]` | 直接 `as Friend[]` | ✅ |
| `POST /api/friends` | Body: `{friend_id}`，直接 accepted | 返回的 FriendResponse 直接 push | ✅ |
| `DELETE /api/friends/:friendId` | 双向删除 | ✅ | ✅ |

### 3.3 消息

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `GET /api/history` | Query: `sender_id, receiver_id, limit, before`；响应含 `has_more` | ✅ 游标分页，解析 `json.has_more` | ✅ |
| `POST /api/messages` | Body: `SendMessageParams` | HTTP 退化路径（WebSocket 优先） | ✅ |
| `POST /api/messages/read` | Body: `{ids: string[]}` | ✅ | ✅ |
| `POST /api/messages/:id/revoke` | 仅发送者可撤回 | ✅ | ✅ |

### 3.4 用户

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `GET /api/users/search?q=` | 模糊搜索 nickname / employee_id | ✅ | ✅ |
| `GET /api/users?sort=` | sort: created_at / nickname / employee_id | ✅ | ✅ |

### 3.5 个人资料

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `PUT /api/me` | Body: `{nickname}`，返回完整 User | ✅ | ✅ |
| `POST /api/me/avatar` | multipart form `file` | ✅ FormData + fetch | ✅ |
| `DELETE /api/me/avatar` | 清空 avatar_url | ✅ | ✅ |

### 3.6 在线状态

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `PUT /api/users/online` | 写 Redis + 广播 WebSocket | ✅ 带 Bearer token | ✅ |
| `PUT /api/users/offline` | 删 Redis + 广播 WebSocket | ✅ 带 Bearer token | ✅ |

### 3.7 群组

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `POST /api/groups` | Body: `{name, member_ids}`，返回 Group | ✅ `json.data as Group` | ✅ |
| `GET /api/groups` | 返回 `GroupResponse[]`（含 member_count, unread_count 等聚合） | ✅ `(json.data ?? []) as Group[]` | ✅ |
| `GET /api/groups/:id/history` | Query: `limit, before`，响应含 `has_more` | ✅ | ✅ |
| `GET /api/groups/:id/members` | 返回 GroupMember[] 含 Preload User | ✅ 扁平化映射 nickname/avatar_url/employee_id | ✅ |
| `POST /api/groups/:id/members` | Body: `{user_id}` | ✅ | ✅ |
| `PUT /api/groups/:id/name` | Body: `{name}`，广播 group_update | ✅ | ✅ |
| `DELETE /api/groups/:id/members/:userId` | 踢人/退群 | ✅ | ✅ |
| `DELETE /api/groups/:id` | 仅群主可解散 | ✅ | ✅ |
| `POST /api/groups/:id/messages/read` | Body: `{ids}` | ✅ | ✅ |

### 3.8 文件上传

| 接口 | Go 后端 | 前端 goChatService.ts | 对齐 |
|------|---------|----------------------|------|
| `POST /api/upload` | multipart: `file, user_id, type`，返回 `{url, file_name, file_size}` | ✅ | ✅ |

---

## 4. WebSocket 协议

### 4.1 连接

```
ws://<host>:<port>/ws?token=<JWT>
```

前端 `subscribeToMessages()` 在获取到 token 后建立连接，Go 侧由 `melody` + JWT 中间件验证身份。

### 4.2 消息结构 (WSMessage)

Go 当前实际结构（[`im/client.go`](../go-chat-server/im/client.go)）：

```go
type WSMessage struct {
    Type       string   `json:"type"`                     // 消息类型
    ID         string   `json:"id,omitempty"`             // 消息 UUID
    SenderID   string   `json:"sender_id,omitempty"`
    ReceiverID string   `json:"receiver_id,omitempty"`
    GroupID    string   `json:"group_id,omitempty"`
    Content    string   `json:"content,omitempty"`
    MsgType    string   `json:"msg_type,omitempty"`       // text/image/file/voice
    IsRead     bool     `json:"is_read,omitempty"`
    IsRevoked  bool     `json:"is_revoked,omitempty"`
    FileName   string   `json:"file_name,omitempty"`
    FileSize   int64    `json:"file_size,omitempty"`
    CreatedAt  string   `json:"created_at,omitempty"`     // ISO 时间字符串
    Timestamp  int64    `json:"timestamp,omitempty"`       // 保留兼容

    // online_status 专用
    UserID   string `json:"user_id,omitempty"`
    IsOnline bool   `json:"is_online,omitempty"`

    // group_update 专用
    Name      string `json:"name,omitempty"`
    AvatarURL string `json:"avatar_url,omitempty"`

    // read_receipt 专用
    MessageIDs []string `json:"message_ids,omitempty"`
}
```

### 4.3 消息类型路由

| type | 方向 | 说明 | Go 实现 | 前端处理 |
|------|------|------|---------|---------|
| `chat` | C→S→C | 聊天消息 | `routeChatMessage` / `routeGroupMessage` | `onMessageCallback` |
| `typing` | C→S→C | 正在输入通知 | `routeTypingNotification` | (暂未使用) |
| `read_receipt` | C→S→C | 已读回执 | `routeReadReceipt` | (暂未使用) |
| `heartbeat` | C→S | 心跳 | 返回 `heartbeat_ack` | — |
| `heartbeat_ack` | S→C | 心跳响应 | — | 忽略 |
| `online_status` | S→C | 在线状态变更广播 | `broadcastOnlineStatus` | `onOnlineStatusCallback` |
| `message_revoke` | S→C | 消息撤回广播 | `BroadcastMessageRevoke` | `onMessageCallback` |
| `group_member_join` | S→C | 群成员加入广播 | `BroadcastGroupMemberJoin` | `onGroupMemberJoinCallback` |
| `group_update` | S→C | 群信息更新广播 | `BroadcastGroupUpdate` | `onGroupUpdateCallback` |

### 4.4 事件回调聚合

前端 `goChatService.ts` 通过**单一 WebSocket 连接**承载所有实时事件。`subscribeToMessages()` 建立连接后，`onmessage` 根据 `raw.type` 分发到不同的回调（`onMessageCallback`、`onOnlineStatusCallback`、`onGroupMemberJoinCallback`、`onGroupUpdateCallback`）。`subscribeToOnlineStatus()` / `subscribeToGroupMembers()` / `subscribeToGroupUpdates()` 仅设置对应的回调引用，不建立独立连接。

---

## 5. 前端 goChatService.ts 实现状态

### 5.1 全部方法状态一览

| 方法 | 状态 | 备注 |
|------|------|------|
| `login()` | ✅ | 写入 `go-chat-token` 到 localStorage |
| `register()` | ✅ | 同上 |
| `logout()` | ✅ | 清除 `go-chat-token`，关闭 WebSocket |
| `restoreSession()` | ✅ | `GET /api/session`，Go 返回 User 在 data 顶层 |
| `fetchHistory()` | ✅ | 游标分页，解析 `has_more` |
| `sendMessage()` | ✅ | WebSocket `type: "chat"` 优先，HTTP 退化 |
| `uploadFile()` | ✅ | `POST /api/upload` multipart |
| `markAsRead()` | ✅ | `POST /api/messages/read` |
| `revokeMessage()` | ✅ | `POST /api/messages/:id/revoke` |
| `fetchFriends()` | ✅ | `GET /api/friends` |
| `addFriend()` | ✅ | `POST /api/friends` |
| `removeFriend()` | ✅ | `DELETE /api/friends/:id` |
| `searchUsers()` | ✅ | `GET /api/users/search?q=` |
| `fetchAllUsers()` | ✅ | `GET /api/users?sort=` |
| `goOnline()` | ✅ | `PUT /api/users/online` |
| `goOffline()` | ✅ | `PUT /api/users/offline` |
| `updateProfile()` | ✅ | `PUT /api/me` |
| `updateAvatar()` | ✅ | `POST /api/me/avatar` |
| `deleteAvatar()` | ✅ | `DELETE /api/me/avatar` |
| `subscribeToMessages()` | ✅ | 单一 WebSocket，分发 6 种事件类型 |
| `subscribeToOnlineStatus()` | ✅ | 设置回调，由 WebSocket 聚合分发 |
| `subscribeToGroupMembers()` | ✅ | 同上 |
| `subscribeToGroupUpdates()` | ✅ | 同上 |
| `createGroup()` | ✅ | `POST /api/groups` |
| `fetchGroups()` | ✅ | `GET /api/groups` |
| `fetchGroupHistory()` | ✅ | 游标分页 |
| `fetchGroupMembers()` | ✅ | 扁平化 Preload User |
| `addGroupMember()` | ✅ | `POST /api/groups/:id/members` |
| `removeGroupMember()` | ✅ | `DELETE /api/groups/:id/members/:uid` |
| `dissolveGroup()` | ✅ | `DELETE /api/groups/:id` |
| `updateGroupName()` | ✅ | `PUT /api/groups/:id/name` |
| `markGroupMessagesAsRead()` | ✅ | `POST /api/groups/:id/messages/read` |

### 5.2 已修复的历史问题

| # | 问题 | 修复 |
|---|------|------|
| 1 | 路由守卫只检查 Supabase session | 增加 Go 模式分支，检查 `localStorage.getItem('go-chat-token')` |
| 2 | login/register 未写 token | 增加 `localStorage.setItem('go-chat-token', ...)` |
| 3 | logout 未清除 token | 增加 `localStorage.removeItem('go-chat-token')` |
| 4 | WebSocket 消息 `type: "message"` | 改为 `type: "chat"` (Go `onMessage` switch 期望 "chat") |
| 5 | goOnline/goOffline 空函数 | 实现 HTTP PUT 调用 |
| 6 | updateProfile/updateAvatar/deleteAvatar 抛 Error | 实现 HTTP 调用 |
| 7 | 9 个群组方法抛 "尚未实现" | 全部实现 HTTP 调用 |
| 8 | restoreSession 解析 `json.data.user` | 修正为 `json.data as User` |
| 9 | WebSocket 回调 stub | 实现 6 种 type 分发 |
| 10 | subscribeToOnlineStatus 等空回调 | 通过共享 WebSocket 聚合分发 |

---

## 6. 路由守卫与鉴权

### 6.1 双模式鉴权

[`router/index.ts`](../client-chat-tauri/src/router/index.ts) 根据 `VITE_BACKEND_TYPE` 分支：

```
VITE_BACKEND_TYPE === 'GO':
  - /login → 有 go-chat-token? → 重定向 /chat : 放行
  - 其他 → 无 go-chat-token? → 重定向 /login?redirect= : 放行

VITE_BACKEND_TYPE === 'SUPABASE' (默认):
  - /login → supabase.auth.getSession() 有效? → /chat : 放行
  - 其他 → supabase.auth.getSession() 无效? → /login?redirect= : 放行
```

### 6.2 Token 存储

| 模式 | 存储 Key | 来源 | 发送方式 |
|------|---------|------|---------|
| Go | `go-chat-token` (localStorage) | `POST /api/login` 或 `/api/register` 响应 | HTTP: `Authorization: Bearer {token}`；WS: `?token={token}` |
| Supabase | SDK 自动管理 (localStorage) | `signInWithPassword` / `signUp` | SDK 自动附带到所有请求 |

---

## 7. 剩余待办

### 7.1 前端

| # | 事项 | 优先级 |
|---|------|--------|
| 1 | 群聊消息发送后本地乐观更新 + WebSocket 回显去重 | P1 |
| 2 | 好友添加：Go 后端直接 accepted（无 pending 流程），一期无"好友申请/同意"UI | P2 |
| 3 | `SearchUsers()` 返回结果与 `ListFriends()` 去重（已添加为好友的不显示） | P2 |
| 4 | TypeScript 严格模式检查（消除 `as` 断言，使用类型守卫） | P3 |

### 7.2 Go 后端

| # | 事项 | 优先级 |
|---|------|--------|
| 1 | `User` 模型是否有 `is_online` 字段（当前仅在聚合响应中动态注入） | P2 |
| 2 | Redis 离线消息持久化与上线批量推送 | P2 |
| 3 | 文件上传大小限制 + 类型白名单校验 | P3 |
| 4 | 群聊 @ 提及功能 | P3 |

---

> **文档同步规则**：当 Go 后端新增/修改接口或前端 `goChatService.ts` 新增/修改方法时，请同步更新本文档。
