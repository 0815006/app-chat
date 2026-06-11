# Supabase 运维手册

> **项目**：app-chat (Tauri 2.x + Vue 3 + TypeScript 桌面聊天工具)  
> **配套文档**：[环境搭建与启动指南](./环境搭建与启动指南.md) | [前端 API 调用参考](./前端API调用参考.md)  
> **配套 SQL 脚本（按执行顺序）**：
> - [01_init_database.sql](./01_init_database.sql) — 建表 + RLS + Realtime
> - [02_add_online_status.sql](./02_add_online_status.sql) — 在线状态
> - [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) — 好友 RPC 函数
> - [04_init_storage_buckets.sql](./04_init_storage_buckets.sql) — Storage 存储桶

---

## 目录

1. [Supabase 架构概览](#1-supabase-架构概览)
2. [Studio 管理面板操作](#2-studio-管理面板操作)
3. [数据库管理](#3-数据库管理)
4. [Row Level Security (RLS) 深度解析](#4-row-level-security-rls-深度解析)
5. [认证系统 (Auth) 配置](#5-认证系统-auth-配置)
6. [实时消息 (Realtime) 配置](#6-实时消息-realtime-配置)
7. [在线状态 (Online Status) 配置](#7-在线状态-online-status-配置)
8. [文件存储 (Storage) 配置](#8-文件存储-storage-配置)
9. [好友管理 RPC 函数](#9-好友管理-rpc-函数)
10. [备份与恢复](#10-备份与恢复)
11. [内网生产部署](#11-内网生产部署)
12. [常用 CLI 命令速查](#12-常用-cli-命令速查)
13. [故障排查指南](#13-故障排查指南)
14. [附录：PostgreSQL 常用查询](#14-附录postgresql-常用查询)

---

## 1. Supabase 架构概览

### 1.1 核心组件

Supabase 是一套基于 PostgreSQL 的开源 BaaS 平台，由以下微服务组成：

```
                    ┌──────────────────────────────┐
                    │      Kong API 网关             │
                    │   (路由、限流、认证代理)         │
                    │   端口: 54321 (本地)            │
                    └──────────┬───────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    GoTrue       │  │   PostgREST     │  │    Storage      │
│   (身份认证)     │  │  (RESTful API)  │  │   (文件存储)     │
│ 端口: 9999      │  │ 端口: 3001      │  │ 端口: 5000      │
└─────────────────┘  └────────┬────────┘  └─────────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │   PostgreSQL    │
                     │  (主数据库)      │
                     │ 端口: 54322     │
                     └────────┬────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Realtime      │  │    Studio       │  │   PgBouncer     │
│  (WebSocket)    │  │  (管理面板)      │  │  (连接池)        │
│ 端口: 4000      │  │ 端口: 54323     │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

| 组件 | 功能 | 本地端口 |
|------|------|----------|
| **Kong** | API 网关，统一入口，JWT 校验 | `54321` |
| **GoTrue** | 用户注册/登录/JWT 签发 | 内部 `9999` |
| **PostgREST** | 将 PostgreSQL 表自动转为 RESTful API | 内部 `3001` |
| **Realtime** | WebSocket 服务，监听 PostgreSQL 变更 | 内部 `4000` |
| **Storage** | S3 兼容对象存储 | 内部 `5000` |
| **PostgreSQL** | 核心数据库 | `54322` |
| **Studio** | Web 管理面板 | `54323` |
| **PgBouncer** | 数据库连接池 | 内部 `6432` |

### 1.2 请求路由

所有客户端请求均发送至 **Kong API 网关 (54321)**，由 Kong 根据路径前缀路由：

| 请求路径前缀 | 路由目标 | 示例 |
|-------------|---------|------|
| `/auth/v1/*` | GoTrue | `POST /auth/v1/signup` |
| `/rest/v1/*` | PostgREST | `GET /rest/v1/profiles` |
| `/rest/v1/rpc/*` | PostgREST (RPC) | `POST /rest/v1/rpc/add_friend` |
| `/storage/v1/*` | Storage | `POST /storage/v1/object/chat-images/...` |
| `/realtime/v1/*` | Realtime | WebSocket 连接 |

> **环境搭建与首次启动**请参见 [环境搭建与启动指南](./环境搭建与启动指南.md)。  
> **前端 SDK 调用细节**请参见 [前端 API 调用参考](./前端API调用参考.md)。

---

## 2. Studio 管理面板操作

### 2.1 访问 Studio

浏览器打开：`http://127.0.0.1:54323`（本地开发无需登录）

### 2.2 功能面板一览

| 左侧菜单 | 功能 | 常用场景 |
|----------|------|---------|
| **Table Editor** | 可视化表数据浏览/编辑 | 查看数据、手动插入测试记录 |
| **SQL Editor** | 执行 SQL 语句 | 建表、查询、插入测试数据 |
| **Database** | 数据库管理 | 查看表结构、索引、触发器、扩展 |
| **Authentication** | 用户认证管理 | 查看/管理用户、配置登录策略 |
| **Storage** | 文件存储管理 | 创建 Bucket、上传/下载文件、设置权限 |
| **Edge Functions** | 边缘函数 | 部署 Deno 函数（本项目暂不用） |
| **Realtime** | 实时订阅 | 查看活跃 WebSocket 连接和频道 |
| **Logs** | 服务日志 | 查看 API 调用日志、错误日志 |
| **API Docs** | 自动生成 API 文档 | 查看各表的 REST API 用法 |

### 2.3 Table Editor 常用操作

1. **查看数据**：点击表名 → 显示所有行（含分页）
2. **插入行**：`+ Insert row` → 填写字段值 → `Save`
3. **编辑行**：悬停在行上 → 点击编辑图标 → 修改 → `Save`
4. **删除行**：勾选行 → `Delete`
5. **导出数据**：`Export` → 选择 CSV
6. **查看表结构**：切换到 `Columns` 标签页

### 2.4 SQL Editor 常用操作

1. `New Query` → 输入 SQL → `Run`
2. 命名后保存，方便复用
3. `EXPLAIN ANALYZE <SQL>` 查看执行计划
4. 左侧 `Query History` 展示历史 SQL

### 2.5 API Docs 使用

Studio → **API Docs** → 选择表 → 查看自动生成的 REST API 文档，包括：
- 支持的 HTTP 方法（GET/POST/PATCH/DELETE）
- 请求示例（curl 命令）
- 过滤、排序、分页参数说明
- 关联查询 (Resource Embedding) 语法
- RPC 函数调用示例

---

## 3. 数据库管理

### 3.1 表结构概览

共 3 张业务表 + 1 张 Auth 系统表：

```
public.
├── profiles       # 用户公开资料（关联 auth.users，含 is_online 在线状态）
├── friendships    # 好友关系（双向存储，有唯一约束）
└── messages       # 聊天消息

auth.
├── users          # Supabase 内置，邮箱/密码/JWT 元数据
```

> **完整建表 SQL 请按顺序执行**：
> 1. [01_init_database.sql](./01_init_database.sql) — 建表、注释、基础 RLS 策略、Realtime 发布
> 2. [02_add_online_status.sql](./02_add_online_status.sql) — 在线状态
> 3. [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) — 好友 RPC + DELETE 策略 + 唯一约束
> 4. [04_init_storage_buckets.sql](./04_init_storage_buckets.sql) — Storage 存储桶

### 3.2 常用查询 SQL

#### 插入测试用户资料

```sql
-- 1. 先在 auth.users 中创建用户（通过注册 API 或 Studio → Authentication → Add User）
-- 2. 手动补 profiles 记录：
INSERT INTO public.profiles (id, nickname, employee_id)
VALUES ('<用户的 UUID>', '测试用户', '0001234');
```

#### 查询双向对话历史

```sql
SELECT * FROM public.messages
WHERE (sender_id = '<用户A UUID>' AND receiver_id = '<用户B UUID>')
   OR (sender_id = '<用户B UUID>' AND receiver_id = '<用户A UUID>')
ORDER BY created_at ASC
LIMIT 100;
```

#### 查询用户的好友列表（带好友信息）

```sql
SELECT
  f.id AS friendship_id,
  f.friend_id,
  p.nickname AS friend_nickname,
  p.employee_id,
  p.avatar_url,
  p.is_online
FROM public.friendships f
JOIN public.profiles p ON f.friend_id = p.id
WHERE f.user_id = '<用户 UUID>';
```

#### 统计未读消息数

```sql
SELECT
  sender_id,
  COUNT(*) AS unread_count
FROM public.messages
WHERE receiver_id = '<用户 UUID>'
  AND is_read = false
GROUP BY sender_id;
```

#### 查看在线用户

```sql
SELECT id, nickname, employee_id, updated_at
FROM public.profiles
WHERE is_online = true;
```

### 3.3 索引优化（生产环境推荐）

```sql
-- 加速历史消息查询（双向对话）
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver
  ON public.messages (sender_id, receiver_id, created_at DESC);

-- 加速好友列表查询
CREATE INDEX IF NOT EXISTS idx_friendships_user_id
  ON public.friendships (user_id);

-- 加速未读消息统计
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
  ON public.messages (receiver_id, is_read)
  WHERE is_read = false;
```

### 3.4 数据清理

```sql
-- 清空聊天记录（保留表结构）
TRUNCATE TABLE public.messages;

-- 删除指定用户的所有数据
DELETE FROM public.messages WHERE sender_id = '<UUID>' OR receiver_id = '<UUID>';
DELETE FROM public.friendships WHERE user_id = '<UUID>' OR friend_id = '<UUID>';
DELETE FROM public.profiles WHERE id = '<UUID>';
```

---

## 4. Row Level Security (RLS) 深度解析

### 4.1 什么是 RLS

Row Level Security 是 PostgreSQL 的行级安全机制。启用后，**即便用户通过了 API 网关的 JWT 认证，也只能看到/操作被策略允许的行**。

### 4.2 核心概念

| 概念 | 说明 |
|------|------|
| `auth.uid()` | PostgreSQL 函数，从当前请求的 JWT 中提取用户 UUID |
| `USING` | 控制**读取**（SELECT/UPDATE/DELETE）时的可见性 |
| `WITH CHECK` | 控制**写入**（INSERT/UPDATE）时的合法性 |
| `FOR SELECT` | 应用于 SELECT 操作 |
| `FOR INSERT` | 应用于 INSERT 操作 |
| `FOR UPDATE` | 应用于 UPDATE 操作 |
| `FOR DELETE` | 应用于 DELETE 操作 |

### 4.3 策略清单（8 条）

#### profiles 表（3 条）

```sql
-- ① 允许用户注册时插入自己的资料
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ② 允许用户更新自己的资料
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ③ 允许所有人查看资料
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);
```

#### messages 表（2 条）

```sql
-- ④ 允许用户发送消息（sender_id 必须是自己）
CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- ⑤ 允许对话双方查看消息
CREATE POLICY "Users can view their conversations"
  ON public.messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
```

#### friendships 表（3 条）

```sql
-- ⑥ 允许用户查看自己的好友关系
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ⑦ 允许 RPC 函数插入（INSERT 由 add_friend RPC 的 SECURITY DEFINER 绕过）
CREATE POLICY "Users can insert own friendships"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ⑧ 允许用户删除自己的好友关系
CREATE POLICY "Users can delete own friendships"
  ON public.friendships FOR DELETE
  USING (auth.uid() = user_id);
```

### 4.4 RLS 操作命令

**在 Studio 中管理**：`Authentication` → `Policies` → 选择表

```sql
-- 查看某表的所有策略
SELECT * FROM pg_policies WHERE tablename = 'messages';

-- 删除某条策略
DROP POLICY IF EXISTS "Users can insert own messages" ON public.messages;

-- 临时禁用 RLS（调试用，仅限本地开发）
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

-- 重新启用
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
```

### 4.5 RLS 调试技巧

当数据操作被 RLS 拦截时的常见表现：
- INSERT 返回空数组而非新行
- SELECT 返回空数组（即使数据存在）
- 无明确错误信息

**调试步骤**：

```sql
-- 1. 确认 RLS 已开启
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('profiles', 'messages', 'friendships');

-- 2. 查看当前策略
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('profiles', 'messages', 'friendships');

-- 3. 模拟 JWT uid 测试
SELECT set_config('request.jwt.claim.sub', '<用户UUID>', false);
SELECT * FROM public.messages;
```

### 4.6 常见 RLS 遗漏场景

| 场景 | 缺少的策略 | 影响 |
|------|-----------|------|
| 用户注册后无法查看自己的资料 | `profiles` 缺少 FOR SELECT | 登录后白屏 |
| 发送消息失败 | `messages` 缺少 FOR INSERT | `sendMessage()` 返回空 |
| 切换好友看不到历史消息 | `messages` 缺少 FOR SELECT | 聊天区始终为空 |
| 添加好友后列表不显示 | `friendships` 缺少 FOR SELECT | `fetchFriends()` 返回空 |
| 无法删除好友 | `friendships` 缺少 FOR DELETE | `removeFriend()` 失败 |

---

## 5. 认证系统 (Auth) 配置

### 5.1 设置入口

Studio → `Authentication` → `Settings`

### 5.2 核心配置项

#### 邮箱确认

```
Enable email confirmations: □ 不勾选（内网环境关闭）
```
- **本地开发**：`supabase start` 默认 `GOTRUE_MAILER_AUTOCONFIRM=true`
- **生产环境**：内网部署应关闭，注册即激活
- **若开启**：用户需点击邮箱确认链接，内网无法收邮件会导致无法登录

#### 密码强度

```
Minimum password length: 6（默认）
```

#### 外部 OAuth 登录

内网部署不需要，全部关闭：
```
Enable GitHub provider: □
Enable Google provider: □
...
```

#### JWT 过期时间

默认 1 小时（3600 秒），可在 `supabase/config.toml` 中调整：

```toml
[auth]
jwt_expiry = 604800  # 7天
```

### 5.3 管理用户

**查看所有注册用户**：Studio → `Authentication` → `Users`

**手动创建用户**（测试用）：
1. `Add User` → `Create new user`
2. 填写邮箱和密码
3. 勾选 `Auto Confirm User`
4. 创建后需手动在 `public.profiles` 中插入对应资料

**删除用户**：在 Users 中选择 → `Delete User`（`profiles` 通过 `ON DELETE CASCADE` 自动级联删除）

### 5.4 自定义 SMTP（可选）

如需真实邮件发送（密码重置等），在 `supabase/config.toml` 中配置：

```toml
[auth.smtp]
host = "smtp.example.com"
port = 587
user = "noreply@example.com"
pass = "your-password"
```

内网环境通常不需要。

---

## 6. 实时消息 (Realtime) 配置

### 6.1 工作原理

1. PostgreSQL 将数据变更写入 WAL (Write-Ahead Log)
2. Realtime 服务订阅 WAL 变更
3. 客户端通过 WebSocket 连接到 Realtime 服务
4. 当匹配的表发生 INSERT/UPDATE/DELETE 时，Realtime 向订阅者推送事件

### 6.2 启用表的 Realtime 发布

```sql
-- 启用
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- 禁用
ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
```

> 已包含在 SQL 脚本中：[01_init_database.sql](./01_init_database.sql) 启动 `messages`，[02_add_online_status.sql](./02_add_online_status.sql) 启动 `profiles`。

**验证**：Studio → `Database` → `Replication` → 查看 `supabase_realtime` 发布中的表列表。

### 6.3 前端订阅代码模式

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

### 6.4 实现要点

| 要点 | 说明 |
|------|------|
| **避免重复订阅** | `initRealtimeListener()` 须检查 `unsubscribeRealtime` 是否已存在 |
| **消息过滤** | 仅当 `sender_id` 或 `receiver_id` 匹配当前活跃聊天时才 push |
| **幂等性** | push 前 `Array.some()` 检查 `id` 是否已存在 |
| **生命周期** | `onMounted` 中订阅，`onUnmounted` 中取消 |
| **自动已读** | 收到对方消息且窗口可见时自动标记已读 |

### 6.5 监控与调试

**查看活跃连接**：Studio → `Realtime` → 查看当前频道和客户端数

**排查不推送**：

```sql
-- 1. 确认表已加入发布
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- 2. 查看 Realtime 日志
```

```bash
docker logs supabase_realtime_supabase --tail 50
```

---

## 7. 在线状态 (Online Status) 配置

### 7.1 数据模型

- `profiles.is_online` (BOOLEAN, DEFAULT false)：标记用户是否在线
- 由两个 SECURITY DEFINER RPC 函数管理：

```sql
-- 上线（设置调用者 is_online = true）
CREATE OR REPLACE FUNCTION public.go_online()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles SET is_online = true WHERE id = auth.uid();
END;
$$;

-- 下线（设置调用者 is_online = false）
CREATE OR REPLACE FUNCTION public.go_offline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles SET is_online = false WHERE id = auth.uid();
END;
$$;
```

> 完整 SQL 见 [02_add_online_status.sql](./02_add_online_status.sql)。

### 7.2 前端调用

| 操作 | SDK 方法 | 调用时机 |
|------|---------|---------|
| 上线 | `supabase.rpc('go_online')` | 聊天页面 `onMounted` |
| 下线 | `supabase.rpc('go_offline')` | 聊天页面 `onUnmounted` |
| 订阅变更 | `channel.on('postgres_changes', { table: 'profiles', event: 'UPDATE' }, ...)` | 聊天页面 `onMounted` |

### 7.3 Realtime 发布

`profiles` 表必须加入 Realtime 发布才能推送在线状态变更：

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
```

### 7.4 故障排查

如果客户端始终显示离线：
1. 确认 `02_add_online_status.sql` 已执行
2. 检查 `profiles` 表是否有 `is_online` 字段
3. 检查 `go_online()` / `go_offline()` RPC 函数是否存在
4. 检查 `profiles` 表是否已加入 Realtime 发布

---

## 8. 文件存储 (Storage) 配置

### 8.1 创建存储桶

**Studio 可视化**：`Storage` → `New Bucket` → 输入名称 → **勾选 `Public bucket`**

**或通过 SQL 自动创建**：执行 [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql)。

### 8.2 Bucket 规划

| Bucket 名称 | 用途 | 公开访问 | 大小限制 | 对应 msg_type |
|------------|------|---------|---------|--------------|
| `chat-images` | 聊天图片 | ✅ | 10MB | `image` |
| `chat-files` | 文件附件 | ✅ | 50MB | `file` |
| `chat-voice` | 语音消息 | ✅ | 5MB | `voice` |

### 8.3 文件路径规范

```
{userId}/{timestamp}_{random}.{ext}
```

示例：`550e8400-e29b-41d4-a716-446655440000/1718000000000_abc123.jpg`

### 8.4 公开访问 URL 格式

```
http://<supabase-url>/storage/v1/object/public/<bucket>/<path>
```

### 8.5 Storage 安全策略

```sql
-- 允许所有人读取公开 Bucket
CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('chat-images', 'chat-files', 'chat-voice'));

-- 仅允许已认证用户上传
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id IN ('chat-images', 'chat-files', 'chat-voice')
  );

-- 允许已认证用户更新自己的文件
CREATE POLICY "Authenticated users can update own files"
  ON storage.objects FOR UPDATE
  USING (auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id IN ('chat-images', 'chat-files', 'chat-voice'));

-- 允许已认证用户删除自己的文件
CREATE POLICY "Authenticated users can delete own files"
  ON storage.objects FOR DELETE
  USING (auth.uid()::text = (storage.foldername(name))[1]);
```

在 Studio → `Storage` → `Policies` 中配置，或通过 [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql) 一次性创建。

---

## 9. 好友管理 RPC 函数

### 9.1 为什么使用 RPC？

好友关系需要**双向写入**（A 加 B → 同时写入 `(A, B)` 和 `(B, A)`）。如果在前端手动执行两次 INSERT，中间失败会导致数据不一致。使用 SECURITY DEFINER RPC 函数在数据库侧原子性完成操作。

### 9.2 add_friend RPC

```sql
CREATE OR REPLACE FUNCTION public.add_friend(p_friend_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  INSERT INTO public.friendships (user_id, friend_id, status) VALUES (v_user_id, p_friend_id, 'accepted');
  INSERT INTO public.friendships (user_id, friend_id, status) VALUES (p_friend_id, v_user_id, 'accepted');
  
  RETURN jsonb_build_object('success', true);
END;
$$;
```

- **前端调用**：`supabase.rpc('add_friend', { p_friend_id: friendId })`
- **SECURITY DEFINER**：以创建者（postgres）权限运行，绕过 RLS
- **唯一约束**：`uq_friendship_pair (user_id, friend_id)` 防止重复添加

### 9.3 remove_friend RPC

```sql
CREATE OR REPLACE FUNCTION public.remove_friend(p_friend_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  DELETE FROM public.friendships WHERE user_id = v_user_id AND friend_id = p_friend_id;
  DELETE FROM public.friendships WHERE user_id = p_friend_id AND friend_id = v_user_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$;
```

> 完整 SQL 见 [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql)，该脚本同时创建唯一约束和 DELETE RLS 策略。

---

## 10. 备份与恢复

### 10.1 Supabase CLI 备份

```bash
# 导出完整数据库（含结构 + 数据 + RLS）
supabase db dump --local --data-only > backup_data_$(date +%Y%m%d).sql

# 仅导出表结构
supabase db dump --local --schema-only > backup_schema.sql

# 导出特定表
supabase db dump --local --data-only --table public.messages > backup_messages.sql
```

### 10.2 pg_dump 直接导出

```bash
pg_dump -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  --table='public.profiles' \
  --table='public.friendships' \
  --table='public.messages' \
  > full_backup.sql
```

### 10.3 恢复

```bash
# 方式一：Supabase CLI
supabase db restore backup.sql

# 方式二：psql 直接执行
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f backup.sql
```

### 10.4 Docker Volume 备份

```bash
# 查看 Volume 名称
docker volume ls | grep supabase

# 备份
docker run --rm -v supabase_db_data:/data -v $(pwd):/backup alpine tar czf /backup/db_volume_backup.tar.gz -C /data .

# 恢复
docker run --rm -v supabase_db_data:/data -v $(pwd):/backup alpine tar xzf /backup/db_volume_backup.tar.gz -C /data
```

### 10.5 生产备份策略建议

| 频率 | 内容 | 保留周期 |
|------|------|---------|
| 每日 | 全量数据备份 | 7 天 |
| 每周 | 全量备份归档 | 4 周 |
| 每月 | 冷备份存档 | 12 个月 |

cron 定时示例：
```bash
0 3 * * * cd /opt/app-chat && supabase db dump --local --data-only > /backup/chat_$(date +\%Y\%m\%d).sql
```

---

## 11. 内网生产部署

### 11.1 部署架构

```
┌─────────────────────────────────────────────────────────┐
│                     内网服务器                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Supabase (Docker)                   │   │
│  │  Kong :54321  │  Studio :54323  │  PG :54322    │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │           客户端 PC (Tauri App)                   │   │
│  │   连接 http://<内网IP>:54321                       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 11.2 镜像离线迁移

```bash
# 1. 联网机器导出镜像
docker images --format '{{.Repository}}:{{.Tag}}' | grep supabase > supabase_images.txt
docker save -o supabase-images.tar $(cat supabase_images.txt | tr '\n' ' ')

# 2. 拷贝到内网服务器

# 3. 内网导入
docker load -i supabase-images.tar

# 4. 验证
docker images | grep supabase
```

### 11.3 修改生产配置

`supabase/config.toml` 中的关键项：

```toml
[auth]
jwt_secret = "your-256-bit-secret-change-me-in-production"

[db]
password = "your-strong-password"

[auth.email]
enable_confirmations = false
```

**生成随机密钥**：

```bash
# JWT Secret（至少 32 字符）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 数据库密码
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 11.4 防火墙配置

| 端口 | 用途 | 访问范围 |
|------|------|---------|
| `54321` | API 网关（客户端连接） | 内网全部 |
| `54323` | Studio 管理面板 | 仅管理员 |
| `54322` | PostgreSQL 直连 | 仅服务器本地 |

```bash
# Windows 防火墙示例
netsh advfirewall firewall add rule name="Supabase API" dir=in action=allow protocol=tcp localport=54321
```

### 11.5 客户端配置

修改 `client-chat-tauri/.env.production`：

```env
VITE_SUPABASE_URL=http://<内网服务器IP>:54321
VITE_SUPABASE_ANON_KEY=<生产环境 Publishable Key>
VITE_BACKEND_TYPE=SUPABASE
```

> **注意**：URL 末尾不加 `/`；不要写成 PostgreSQL 端口 `54322`。

### 11.6 开机自启（Linux systemd）

```ini
# /etc/systemd/system/supabase.service
[Unit]
Description=Supabase Local
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/app-chat
ExecStart=/usr/local/bin/supabase start
ExecStop=/usr/local/bin/supabase stop
User=root
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable supabase
sudo systemctl start supabase
```

---

## 12. 常用 CLI 命令速查

### 12.1 生命周期

```bash
supabase init          # 初始化
supabase start         # 启动
supabase stop          # 停止（保留数据）
supabase stop --no-backup  # 停止并清空
supabase status        # 查看运行状态
```

### 12.2 数据库

```bash
supabase db diff --linked --file <name>  # 生成迁移文件
supabase db push                         # 推送迁移
supabase db reset                        # 重置（清空所有数据）
supabase db dump --local --data-only     # 导出数据
supabase db dump --local --schema-only   # 导出结构
```

### 12.3 日志

```bash
supabase logs                     # 所有服务
supabase logs --type auth         # GoTrue
supabase logs --type rest         # PostgREST
supabase logs --type realtime     # Realtime
supabase logs --type db           # PostgreSQL
supabase logs --tail 100          # 最近 100 行
```

### 12.4 容器管理

```bash
docker ps --filter "name=supabase"              # 查看容器状态
docker restart supabase_db_supabase             # 重启单个容器
docker logs supabase_kong_supabase --tail 50    # 查看容器日志
docker exec -it supabase_db_supabase psql -U postgres  # 进入 PostgreSQL
```

---

## 13. 故障排查指南

### 13.1 `supabase start` 卡住

```bash
# 检查 Docker
docker info

# 手动拉取镜像
docker pull public.ecr.aws/supabase/postgres:15.6.1.113
```

### 13.2 容器不断重启

```bash
docker logs supabase_db_supabase --tail 100
docker logs supabase_auth_supabase --tail 100
```

### 13.3 注册失败：`Database error`

1. `profiles` 表不存在 → 执行 [01_init_database.sql](./01_init_database.sql)
2. `profiles` 缺少 INSERT 策略 → 检查 RLS 策略
3. `auth.users` 表损坏 → `supabase db reset`

### 13.4 查询返回空数组

```sql
-- 1. 确认数据存在
SELECT COUNT(*) FROM public.messages;

-- 2. 确认 RLS 策略
SELECT * FROM pg_policies WHERE tablename = 'messages';

-- 3. 模拟用户身份测试
SELECT set_config('request.jwt.claim.sub', '<用户UUID>', false);
SELECT * FROM public.messages;
```

### 13.5 外键约束错误

```
ERROR: insert or update on table "messages" violates foreign key constraint
```

**原因**：`sender_id` 或 `receiver_id` 对应的 `profiles` 记录不存在。  
**解决**：确认用户已在 `profiles` 表中有记录。

### 13.6 登录成功但 profiles 查询失败

```sql
-- 手动补全缺失的 profiles
INSERT INTO public.profiles (id, nickname, employee_id)
SELECT id, email, '0000000'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);
```

### 13.7 Realtime 不推送

1. 表是否已加入发布：
   ```sql
   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   ```
2. 前端是否正确订阅（channel 名称、filter 条件）
3. WebSocket 连接是否建立（浏览器 DevTools → Network → WS）
4. Realtime 服务日志：
   ```bash
   docker logs supabase_realtime_supabase --tail 50
   ```

### 13.8 收到重复消息

**原因**：多次调用 `initRealtimeListener()` 导致重复订阅。  
**解决**：订阅前检查并移除旧订阅。

### 13.9 Storage 上传失败

1. Bucket 是否已创建？（执行 [04_init_storage_buckets.sql](./04_init_storage_buckets.sql)）
2. Bucket 是否设为公开？
3. 文件是否超大小限制？
4. Storage RLS 策略是否正确？

### 13.10 文件 URL 无法访问

**原因**：Bucket 未设为公开，或 URL 格式错误。  
**正确格式**：`http://127.0.0.1:54321/storage/v1/object/public/<bucket>/<path>`

### 13.11 客户端始终显示"离线"

1. 确认 [02_add_online_status.sql](./02_add_online_status.sql) 已执行
2. 检查 `profiles.is_online` 字段是否存在
3. 检查 `go_online()` / `go_offline()` RPC 函数是否存在
4. 检查 `profiles` 表是否已加入 Realtime 发布

### 13.12 添加好友失败

1. 确认 [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) 已执行
2. 确认 `add_friend` RPC 函数存在
3. 确认 `uq_friendship_pair` 唯一约束存在（防止重复添加）
4. 确认目标用户在 `profiles` 表中存在

---

## 14. 附录：PostgreSQL 常用查询

### 14.1 系统信息

```sql
-- 查看所有表
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- 查看表结构
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'messages';

-- 查看所有 RLS 策略
SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies;

-- 查看索引
SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public';

-- 查看所有 RPC 函数
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';

-- 查看 Realtime 发布中的表
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

### 14.2 数据统计

```sql
-- 各表行数
SELECT 'profiles' AS tbl, COUNT(*) FROM public.profiles
UNION ALL
SELECT 'friendships', COUNT(*) FROM public.friendships
UNION ALL
SELECT 'messages', COUNT(*) FROM public.messages;

-- 各用户消息数
SELECT p.nickname, COUNT(*) AS msg_count
FROM public.messages m
JOIN public.profiles p ON m.sender_id = p.id
GROUP BY p.nickname
ORDER BY msg_count DESC;

-- 在线用户数
SELECT COUNT(*) AS online_count FROM public.profiles WHERE is_online = true;

-- 数据库总大小
SELECT pg_size_pretty(pg_database_size('postgres'));
```

### 14.3 清理与维护

```sql
-- 清理死元组
VACUUM ANALYZE public.messages;

-- 重建索引
REINDEX TABLE public.messages;

-- 清空表但保留结构
TRUNCATE TABLE public.messages;
TRUNCATE TABLE public.messages, public.friendships, public.profiles CASCADE;
```

---

## 文档维护

| 文档 | 定位 | 更新时机 |
|------|------|---------|
| **本文档** | Supabase 运维与操作深度指导 | 数据库变更、配置调整、部署变化 |
| [环境搭建与启动指南](./环境搭建与启动指南.md) | 首次启动与测试清单 | 环境要求变化、启动流程调整 |
| [前端 API 调用参考](./前端API调用参考.md) | 前端 SDK 调用细节 | `chatService.ts` 新增/修改方法 |
| SQL 脚本（01-04） | 数据库迁移脚本 | 表结构变更 |

> **提示**：遇到 Supabase 问题先查阅本文档第 13 节故障排查；环境搭建问题查阅启动指南；前端调用细节查阅 API 参考。
