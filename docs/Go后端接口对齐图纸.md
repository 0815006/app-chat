# Go 后端接口对齐图纸

> **目的**：基于前端 `IChatService` 接口契约 + `goChatService.ts` 已定义的 API 路径，**反向推导** Go 后端需实现的完整 HTTP / WebSocket 接口清单、数据模型差异、请求/响应格式。
>
> **配套文档**：[前端API调用参考.md](./前端API调用参考.md) | [Supabase运维手册.md](./Supabase运维手册.md)

---

## 目录

1. [现有 Go 后端现状](#1-现有-go-后端现状)
2. [数据模型差异对照](#2-数据模型差异对照)
3. [HTTP 接口清单（按完成度）](#3-http-接口清单按完成度)
4. [WebSocket 协议定义](#4-websocket-协议定义)
5. [统一响应格式](#5-统一响应格式)
6. [前端 goChatService.ts 待修正项](#6-前端-gochatservicets-待修正项)
7. [实现优先级建议](#7-实现优先级建议)

---

## 1. 现有 Go 后端现状

### 1.1 已实现的路由

| 方法 | 路径 | Handler | 鉴权 | 状态 |
|------|------|---------|------|------|
| `GET` | `/api/ping` | 内联 | 无 | ✅ |
| `POST` | `/api/register` | `api.Register` | 无 | ✅ |
| `POST` | `/api/login` | `api.Login` | 无 | ✅ |
| `GET` | `/api/me` | `api.GetMe` | JWT | ✅ |
| `GET` | `/api/friends` | `api.ListFriends` | JWT | ✅ |
| `POST` | `/api/friends` | `api.AddFriend` | JWT | ✅ |
| `PUT` | `/api/friends/:id` | `api.UpdateFriendStatus` | JWT | ✅ (接受申请) |
| `GET` | `/api/history` | `api.GetHistory` | JWT | ⚠️ 参数不匹配 |
| `GET` | `/ws` | `im.Manager.HandleWebSocketGin` | Token Query | ✅ |

### 1.2 缺失的完整功能模块（共 22 项）

---

## 2. 数据模型差异对照

### 2.1 User（用户）

| 字段 | 前端 TypeScript | Go Model | 差异 |
|------|----------------|----------|------|
| `id` | `string` (UUID) | `string` (varchar 36) | ✅ 一致 |
| `nickname` | `string` | `string` (varchar 100) | ✅ 一致 |
| `email` | `string?` | `string` (varchar 255) | ⚠️ Go 序列化时暴露了 email（应评估隐私） |
| `password` | ❌ 不存在 | `string` (json:"-") | ✅ Go 已隐藏 |
| `employee_id` | `string` | `string` (varchar 10) | ⚠️ JSON key 不一致：前端 `employee_id`，Go `employee_id`（一致） |
| `avatar_url` | `string?` | `string` (varchar 500) | ✅ 一致 |
| `is_online` | ❌ (在 User 中没有，在 Friend 中有) | ❌ **缺失** | 🔴 Go 需新增字段或通过 Redis 动态填充 |
| `status` | `'online' \| 'offline' \| 'away'?` | ❌ **缺失** | 🔴 需根据 Redis 在线状态动态计算 |
| `created_at` | `string?` (ISO) | `time.Time` (autoCreateTime) | ✅ 一致 |
| `updated_at` | ❌ | `time.Time` (autoUpdateTime) | ✅ Go 多了（无害） |

**Go 需新增**：`is_online` 字段到 User 结构体（或通过 Service 层动态查询 Redis 注入）。

### 2.2 Message（消息）

| 字段 | 前端 TypeScript | Go Model | 差异 |
|------|----------------|----------|------|
| `id` | `string` (UUID) | `string` (varchar 36) | ✅ 一致 |
| `msg_type` | `'text' \| 'image' \| 'file' \| 'voice'` | `string` (varchar 20) | ✅ 一致 |
| `content` | `string` | `string` (text) | ✅ 一致 |
| `sender_id` | `string` | `string` (varchar 36) | ✅ 一致 |
| `receiver_id` | `string` | `string` (varchar 36) | ✅ 一致 |
| `group_id` | `string?` | ❌ **缺失** | 🔴 Go 需新增（群聊消息标识） |
| `created_at` | `string` (ISO) | `time.Time` (autoCreateTime) | ✅ 一致 |
| `is_read` | `boolean?` | `bool` | ✅ 一致 |
| `is_revoked` | `boolean?` | ❌ **缺失** | 🔴 Go 需新增（消息撤回标记） |
| `file_name` | `string?` | ❌ **缺失** | 🔴 Go 需新增（文件/图片/语音原始文件名） |
| `file_size` | `number?` | ❌ **缺失** | 🔴 Go 需新增（文件字节数） |

**Go 需新增字段**：`GroupID`, `IsRevoked`, `FileName`, `FileSize`。

### 2.3 Friendship（好友关系）

| 字段 | 前端 TypeScript (Friend) | Go Model | 差异 |
|------|--------------------------|----------|------|
| `id` | `string` | `string` (varchar 36) | ✅ 一致 |
| `user_id` | ❌ (隐式) | `string` | ✅ |
| `friend_id` | `string` | `string` | ✅ 一致 |
| `status` | ❌ (隐式) | `string` (accepted/pending) | ✅ |
| `name` | `string` | 通过 `Friend *User` Preload | ⚠️ 前端期望平铺 |
| `online` | `boolean?` | ❌ **缺失** | 🔴 前端 Friend 对象需要在线状态 |
| `avatar_url` | `string?` | 通过 `Friend *User` Preload | ⚠️ 前端期望平铺 |
| `employee_id` | `string?` | 通过 `Friend *User` Preload | ⚠️ 前端期望平铺 |
| `last_message` | `string?` | ❌ **缺失** | 🔴 前端好友列表摘要需要 |
| `last_message_type` | `string?` | ❌ **缺失** | 🔴 前端用以渲染 `[图片]` / `[文件]` 标签 |
| `last_message_at` | `string?` | ❌ **缺失** | 🔴 前端用以排序和显示时间 |
| `unread_count` | `number?` | ❌ **缺失** | 🔴 前端未读红点需要 |

**设计决定**：`ListFriends` 接口返回的是前端 `Friend` 类型的聚合视图（好友资料 + 最后消息摘要 + 未读计数 + 在线状态），Go 后端需在 Service 层做聚合，不能直接返回裸 `Friendship` 结构体。

### 2.4 新增表：Group（群组）与 GroupMember（群成员）

Go 后端当前**完全没有**群组相关的 model / table / API。需要新增：

#### groups 表
```go
type Group struct {
    ID        string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
    Name      string    `json:"name" gorm:"type:varchar(200);not null;comment:群组名称"`
    AvatarURL string    `json:"avatar_url" gorm:"type:varchar(500);comment:群头像URL"`
    OwnerID   string    `json:"owner_id" gorm:"type:varchar(36);not null;index;comment:群主ID"`
    CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
    UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}
```

#### group_members 表
```go
type GroupMember struct {
    ID       string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
    GroupID  string    `json:"group_id" gorm:"type:varchar(36);not null;index;comment:群组ID"`
    UserID   string    `json:"user_id" gorm:"type:varchar(36);not null;index;comment:用户ID"`
    Role     string    `json:"role" gorm:"type:varchar(20);not null;default:'member';comment:owner/admin/member"`
    JoinedAt time.Time `json:"joined_at" gorm:"autoCreateTime;comment:加入时间"`

    // 关联
    User  *User  `json:"user,omitempty" gorm:"foreignKey:UserID;references:ID"`
    Group *Group `json:"group,omitempty" gorm:"foreignKey:GroupID;references:ID"`
}
```

---

## 3. HTTP 接口清单（按完成度）

### 3.1 ✅ 已实现且对齐（3 项）

| # | 方法 | 路径 | Go Handler | 前端调用 | 备注 |
|---|------|------|-----------|---------|------|
| 1 | `POST` | `/api/register` | `api.Register` | `goChatService.register()` | ✅ 字段名一致 |
| 2 | `POST` | `/api/login` | `api.Login` | `goChatService.login()` | ✅ 返回 `{user, token}` |
| 3 | `GET` | `/api/me` | `api.GetMe` | 可对接 `restoreSession()` | ✅ 需确认响应格式 |

### 3.2 ⚠️ 已实现但参数/响应不匹配（3 项）

#### #4 `GET /api/friends` — 好友列表

| 维度 | 前端 goChatService.ts 期望 | Go 当前实现 | 修复方向 |
|------|--------------------------|------------|---------|
| URL | `GET /api/friends` | `GET /api/friends` | ✅ 一致 |
| 鉴权 | `Bearer {token}` | JWT 中间件 | ✅ 一致 |
| 响应格式 | `{ code: 200, data: Friend[] }` | `{ code: 200, data: []model.Friendship }` | 🔴 **数据形状不同** |
| 数据内容 | Friend 含 `name, online, avatar_url, employee_id, last_message, last_message_type, last_message_at, unread_count` | 仅 Friendship + Preload Friend User | 🔴 **需聚合** |

**Go 修改方案**：`ListFriends` Service 方法需改为返回聚合后的 `FriendResponse` 结构体，包含：
- 好友基本资料（昵称、工号、头像）
- Redis 在线状态（`online:{userID}`）
- 最后一条消息摘要（`content`, `msg_type`, `created_at`, `is_revoked`, `sender_id`）
- 未读计数（`is_read=false AND is_revoked=false AND sender_id=friendID AND receiver_id=currentUserID`）

#### #5 `GET /api/history` — 历史消息

| 维度 | 前端 goChatService.ts 期望 | Go 当前实现 | 修复方向 |
|------|--------------------------|------------|---------|
| 参数 | `sender_id`, `receiver_id`, `limit`, `before` (cursor) | `friend_id`, `limit`, `offset` | 🔴 **参数名不同，分页策略不同** |
| 响应 | `{ code: 200, data: Message[], has_more: boolean }` | `{ code: 200, data: []model.Message }` | 🔴 **缺少 has_more** |
| 排序 | 前端自行 reverse() 为升序 | 服务端 `DESC` 返回 | ⚠️ 可保持服务端 DESC |

**Go 修改方案**：
- 参数改为：`sender_id` (query), `receiver_id` (query), `limit` (query, default 20), `before` (query, optional — 游标 `created_at` 值)
- 游标分页：`WHERE created_at < ?` **(注意是小于，因为 DESC）**
- 响应增加 `has_more` 字段
- 消息需包含新增字段 `group_id`, `is_revoked`, `file_name`, `file_size`

#### #6 `POST /api/friends` — 添加好友

| 维度 | 前端 goChatService.ts 期望 | Go 当前实现 | 修复方向 |
|------|--------------------------|------------|---------|
| 请求体 | `{ friend_id: string }` | `{ friend_id: string }` | ✅ 一致 |
| 响应 | `{ code: 200, data: Friend }` | `{ code: 200, data: model.Friendship }` | 🔴 需返回聚合 Friend |
| 状态 | 直接建立好友关系 | 写入 `pending` 状态 | ⚠️ 一期 Supabase 直接 accepted |

> **决定**：一期前端没有"好友申请/同意"流程，直接添加即为好友。Go 后端要么也改为直接 `accepted`，要么保持 `pending` 并要求前端增加对应 UI。**建议对齐 Supabase 行为：直接 accepted**。

### 3.3 🔴 完全缺失（19 项）

#### 认证与会话

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 7 | `GET` | `/api/session` | 恢复会话 | 无 (Header: `Authorization: Bearer {token}`) | `{ code, data: { user: User, token: string } }` |

> 前端 `restoreSession()` 读取 localStorage 中的 token，调此接口验证 token 有效性并获取当前用户。若 token 无效返回 401 → 前端清除 token 返回 null。

#### 好友管理

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 8 | `DELETE` | `/api/friends/:friendId` | 删除好友 | 无 | `{ code: 200, message: "已删除好友" }` |

> 删除时双向删除两条 friendship 记录。建议放在事务中。

#### 消息（REST 退化路径）

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 9 | `POST` | `/api/messages` | 发送消息 (HTTP 退化) | `SendMessageParams` (含 `group_id?`, `file_name?`, `file_size?`) | `{ code: 200, data: Message }` |
| 10 | `POST` | `/api/messages/read` | 批量标记已读 | `{ ids: string[] }` | `{ code: 200, message: "success" }` |
| 11 | `POST` | `/api/messages/:messageId/revoke` | 撤回消息 | 无 | `{ code: 200, message: "已撤回" }` |

> `POST /api/messages` 仅在 WebSocket 不可用时作为退化路径。正常聊天走 WebSocket `chat` 消息。

#### 文件上传

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 12 | `POST` | `/api/upload` | 上传文件 | `multipart/form-data`: `file`, `user_id`, `type` (image/file/voice) | `{ code: 200, data: { url: string, file_name: string, file_size: number } }` |

> 服务端校验：图片 ≤10MB，文件 ≤50MB，语音 ≤5MB。存储到本地磁盘或 MinIO/S3，返回公开访问 URL。

#### 用户搜索与列表

| # | 方法 | 路径 | 用途 | Query 参数 | 响应体 |
|---|------|------|------|-----------|--------|
| 13 | `GET` | `/api/users/search` | 搜索用户 | `q` (昵称或工号模糊搜索) | `{ code: 200, data: User[] }` |
| 14 | `GET` | `/api/users` | 获取所有用户 | `sort` (created_at/nickname/employee_id) | `{ code: 200, data: User[] }` |

> `User` 响应需包含 `is_online` 字段（从 Redis 查询）。

#### 在线状态

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 15 | `PUT` | `/api/users/online` | 标记上线 | 空 | `{ code: 200 }` |
| 16 | `PUT` | `/api/users/offline` | 标记离线 | 空 | `{ code: 200 }` |

> 当前 Go 上线/下线由 WebSocket connect/disconnect 自动处理。HTTP 端点用于 WebSocket 未连接时的显式状态管理（如页面卸载）。

#### 个人资料

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 17 | `PUT` | `/api/me` | 更新昵称 | `{ nickname: string }` | `{ code: 200, data: User }` |
| 18 | `POST` | `/api/me/avatar` | 上传头像 | `multipart/form-data`: `file` (≤5MB) | `{ code: 200, data: { avatar_url: string } }` |
| 19 | `DELETE` | `/api/me/avatar` | 删除头像 | 无 | `{ code: 200, data: { avatar_url: "" } }` |

#### 群组（全部缺失）

| # | 方法 | 路径 | 用途 | 请求体 | 响应体 |
|---|------|------|------|--------|--------|
| 20 | `POST` | `/api/groups` | 创建群组 | `{ name: string, member_ids: string[] }` | `{ code: 200, data: Group }` |
| 21 | `GET` | `/api/groups` | 获取群组列表 | 无 | `{ code: 200, data: Group[] }` (含聚合) |
| 22 | `GET` | `/api/groups/:groupId/history` | 群消息历史 | Query: `limit`(默认20), `before`(游标) | `{ code: 200, data: Message[], has_more: boolean }` |
| 23 | `GET` | `/api/groups/:groupId/members` | 群成员列表 | 无 | `{ code: 200, data: GroupMember[] }` |
| 24 | `POST` | `/api/groups/:groupId/members` | 拉人进群 | `{ user_id: string }` | `{ code: 200 }` |
| 25 | `PUT` | `/api/groups/:groupId/name` | 修改群名 | `{ name: string }` | `{ code: 200 }` |
| 26 | `DELETE` | `/api/groups/:groupId/members/:userId` | 踢人/退群 | 无 | `{ code: 200 }` |
| 27 | `DELETE` | `/api/groups/:groupId` | 解散群组 | 无 | `{ code: 200 }` |
| 28 | `POST` | `/api/groups/:groupId/messages/read` | 标记群消息已读 | `{ ids: string[] }` | `{ code: 200 }` |

---

## 4. WebSocket 协议定义

### 4.1 连接建立

```
ws://<host>:<port>/ws?token=<JWT_TOKEN>
```

Go 当前已实现 JWT 解析和在线管理。**无需修改**。

### 4.2 消息格式（统一信封）

当前 Go `WSMessage`：
```go
type WSMessage struct {
    Type       string `json:"type"`
    SenderID   string `json:"sender_id"`
    ReceiverID string `json:"receiver_id"`
    Content    string `json:"content"`
    MsgType    string `json:"msg_type"`
    MessageID  string `json:"message_id,omitempty"`
    Timestamp  int64  `json:"timestamp"`
}
```

**需扩展**为与前端 `Message` 接口对齐：
```go
type WSMessage struct {
    Type       string `json:"type"`
    MessageID  string `json:"id"`              // 🔴 改为 id（对齐前端 Message 接口）
    SenderID   string `json:"sender_id"`
    ReceiverID string `json:"receiver_id"`
    GroupID    string `json:"group_id,omitempty"` // 🔴 新增
    Content    string `json:"content"`
    MsgType    string `json:"msg_type"`
    IsRead     bool   `json:"is_read,omitempty"`   // 🔴 新增
    IsRevoked  bool   `json:"is_revoked,omitempty"`// 🔴 新增
    FileName   string `json:"file_name,omitempty"`  // 🔴 新增
    FileSize   int64  `json:"file_size,omitempty"`  // 🔴 新增
    CreatedAt  string `json:"created_at,omitempty"` // 🔴 新增（ISO 时间字符串）
    Timestamp  int64  `json:"timestamp,omitempty"`  // 保留兼容
}
```

### 4.3 消息类型定义

| type | 方向 | 用途 |
|------|------|------|
| `chat` | C↔S | 聊天消息（发送/接收） |
| `typing` | C→S→C | 正在输入通知 |
| `read_receipt` | C→S→C | 已读回执 |
| `heartbeat` | C→S | 心跳 |
| `heartbeat_ack` | S→C | 心跳响应 |
| `online_status` | S→C | 🔴 **新增**：在线状态变更广播 |
| `group_member_join` | S→C | 🔴 **新增**：群成员加入通知 |
| `group_update` | S→C | 🔴 **新增**：群信息更新广播 |
| `message_revoke` | S→C | 🔴 **新增**：消息撤回通知 |

### 4.4 在线状态广播

当用户 WebSocket 连接/断开时，Manager 向所有在线好友广播：
```json
{
  "type": "online_status",
  "user_id": "uuid-xxx",
  "is_online": true
}
```

替代 Supabase 的 `subscribeToOnlineStatus()` Realtime 订阅。

### 4.5 群成员实时感知

当有成员加入群组时：
```json
{
  "type": "group_member_join",
  "group_id": "uuid-xxx",
  "user_id": "uuid-yyy"
}
```

### 4.6 群信息更新广播

群名修改后，向该群所有在线成员广播：
```json
{
  "type": "group_update",
  "group_id": "uuid-xxx",
  "name": "新群名",
  "avatar_url": "https://..."
}
```

---

## 5. 统一响应格式

所有 HTTP 接口严格遵循：

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

| code | 含义 |
|------|------|
| `200` | 成功 |
| `400` | 参数错误 |
| `401` | 未登录 / Token 无效 |
| `404` | 资源不存在 |
| `409` | 冲突（如重复注册） |
| `500` | 服务端错误 |

> 前端 `goChatService.ts` 已实现 `code !== 200` 检查。

---

## 6. 前端 goChatService.ts 待修正项

当前 `goChatService.ts` 存在一些临时/占位实现，Go 后端完善后需同步修正：

| # | 位置 | 当前状态 | 修正方向 |
|---|------|---------|---------|
| 1 | `goOnline()` | 空函数体 | 实现 `PUT /api/users/online` 调用 |
| 2 | `goOffline()` | 空函数体 | 实现 `PUT /api/users/offline` 调用 |
| 3 | `subscribeToOnlineStatus()` | 返回空操作 | 改为监听 WebSocket `online_status` 消息 |
| 4 | `updateProfile()` | `throw Error` | 实现 `PUT /api/me` |
| 5 | `updateAvatar()` | `throw Error` | 实现 `POST /api/me/avatar` |
| 6 | `deleteAvatar()` | `throw Error` | 实现 `DELETE /api/me/avatar` |
| 7 | 所有群组方法 (8个) | `throw Error` | 实现对应 HTTP/WS 调用 |
| 8 | `subscribeToGroupMembers()` | 空操作 | 改为监听 WebSocket `group_member_join` |
| 9 | `subscribeToGroupUpdates()` | 空操作 | 改为监听 WebSocket `group_update` |
| 10 | `login()` | 返回 `session: json.data.token` | 需增加 `localStorage.setItem('go-chat-token', token)` |
| 11 | `register()` | 返回 `session: json.data.token` | 需增加 `localStorage.setItem('go-chat-token', token)` |

---

## 7. 实现优先级建议

### 第一阶段：核心私聊闭环（P0）

| 接口 | 用途 |
|------|------|
| `GET /api/session` | 恢复会话 |
| `GET /api/history` (修正) | 历史消息（修正参数+has_more+游标分页） |
| `POST /api/messages` | HTTP 退化发送 |
| `POST /api/messages/read` | 标记已读 |
| `POST /api/messages/:id/revoke` | 撤回消息 |
| `DELETE /api/friends/:friendId` | 删除好友 |
| Message 模型新增字段 | `group_id, is_revoked, file_name, file_size` |
| Friendship List 聚合 | 含最后消息摘要、未读计数、在线状态 |
| WS `online_status` 广播 | 在线状态实时同步 |

### 第二阶段：用户体系增强（P1）

| 接口 | 用途 |
|------|------|
| `GET /api/users/search` | 搜索用户 |
| `GET /api/users` | 所有用户列表 |
| `PUT /api/me` | 修改昵称 |
| `PUT /api/users/online` | 显式上线 |
| `PUT /api/users/offline` | 显式离线 |
| `POST /api/upload` | 文件上传 |
| `POST /api/me/avatar` | 头像上传 |
| `DELETE /api/me/avatar` | 删除头像 |

### 第三阶段：群聊（P2）

| 接口 | 用途 |
|------|------|
| Group + GroupMember 表 | 数据模型 |
| `POST /api/groups` | 创建群组 |
| `GET /api/groups` | 群列表 |
| `GET /api/groups/:id/history` | 群历史 |
| `GET /api/groups/:id/members` | 群成员 |
| `POST /api/groups/:id/members` | 拉人 |
| `PUT /api/groups/:id/name` | 改名 |
| `DELETE /api/groups/:id/members/:uid` | 踢人 |
| `DELETE /api/groups/:id` | 解散 |
| `POST /api/groups/:id/messages/read` | 标记已读 |
| WS `group_member_join` | 进群通知 |
| WS `group_update` | 群信息变更广播 |

---

> **文档同步**：当 Go 后端新增接口时，请同步更新本文档对应项的完成状态。
