# Supabase 运维手册

> **项目**：app-chat (Tauri 2.x + Vue 3 + TypeScript 桌面聊天工具)  
> **配套文档**：[环境搭建与启动指南](./app-chat环境搭建与启动指南.md) | [前端 API 调用参考](./app-chat前端API调用参考.md) | [Go 后端接口对齐图纸](./app-chat后端Go接口对齐图纸.md)  
> **配套 SQL 脚本（按执行顺序）**：
> - [01_init_database.sql](./01_init_database.sql) — 建表 + RLS + Realtime
> - [02_add_online_status.sql](./02_add_online_status.sql) — 在线状态
> - [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) — 好友 RPC 函数
> - [04_init_storage_buckets.sql](./04_init_storage_buckets.sql) — Storage 存储桶
> - [05_add_file_metadata.sql](./05_add_file_metadata.sql) — 文件元数据字段
> - [06_add_is_revoked.sql](./06_add_is_revoked.sql) — 消息撤回字段
> - [07_fix_revoke_realtime.sql](./07_fix_revoke_realtime.sql) — 撤回实时推送修复
> - [08_group_chat.sql](./08_group_chat.sql) — 群聊建表+RPC+RLS
> - [09_relax_group_permissions.sql](./09_relax_group_permissions.sql) — 群权限放宽（任何人可邀请/改群名）

---

## 目录

1. [Supabase 架构概览](#1-supabase-架构概览)
2. [Studio 管理面板操作](#2-studio-管理面板操作)
3. [数据库管理](#3-数据库管理)
4. [Row Level Security (RLS) 全策略清单](#4-row-level-security-rls-全策略清单)
5. [认证系统 (Auth) 配置](#5-认证系统-auth-配置)
6. [实时消息 (Realtime) 配置](#6-实时消息-realtime-配置)
7. [在线状态 (Online Status) 配置](#7-在线状态-online-status-配置)
8. [文件存储 (Storage) 配置](#8-文件存储-storage-配置)
9. [好友管理 RPC 函数](#9-好友管理-rpc-函数)
10. [消息撤回机制](#10-消息撤回机制)
11. [文件元数据字段](#11-文件元数据字段)
12. [群聊系统](#12-群聊系统)
13. [备份与恢复](#13-备份与恢复)
14. [内网生产部署](#14-内网生产部署)
15. [常用 CLI 命令速查](#15-常用-cli-命令速查)
16. [故障排查指南](#16-故障排查指南)
17. [附录：PostgreSQL 常用查询](#17-附录postgresql-常用查询)

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

> **环境搭建与首次启动**请参见 [环境搭建与启动指南](./app-chat环境搭建与启动指南.md)。  
> **前端 SDK 调用细节**请参见 [前端 API 调用参考](./app-chat前端API调用参考.md)。

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

共 5 张业务表 + 1 张 Auth 系统表：

```
public.
├── profiles          # 用户公开资料（关联 auth.users，含 is_online 在线状态）
├── friendships       # 好友关系（双向存储，有唯一约束）
├── messages          # 聊天消息（含 group_id 群聊支持、is_revoked 撤回、file_name/file_size 元数据）
├── groups            # 群组信息
└── group_members     # 群成员关系

auth.
├── users             # Supabase 内置，邮箱/密码/JWT 元数据
```

> **完整建表 SQL 请按序号顺序执行**（01 → 09），各脚本职责：
> 
> | # | 文件名 | 职责 |
> |---|--------|------|
> | 1 | `01_init_database.sql` | 建表（profiles/friendships/messages）、注释、基础 RLS、Realtime |
> | 2 | `02_add_online_status.sql` | 在线状态字段 + go_online/go_offline RPC |
> | 3 | `03_fix_friendship_rls.sql` | 好友 add_friend/remove_friend RPC + 唯一约束 + DELETE 策略 |
> | 4 | `04_init_storage_buckets.sql` | Storage 3 个存储桶 + RLS |
> | 5 | `05_add_file_metadata.sql` | messages 表 file_name/file_size 字段 |
> | 6 | `06_add_is_revoked.sql` | messages 表 is_revoked 撤回字段 |
> | 7 | `07_fix_revoke_realtime.sql` | REPLICA IDENTITY FULL + UPDATE RLS 策略 |
> | 8 | `08_group_chat.sql` | groups/group_members 表 + 群聊 RPC + RLS + Realtime |
> | 9 | `09_relax_group_permissions.sql` | 放宽 add_group_member + update_group_name RPC + 群成员 UPDATE 策略 |

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

#### 查询群聊消息

```sql
SELECT m.*, p.nickname AS sender_nickname, p.avatar_url AS sender_avatar
FROM public.messages m
JOIN public.profiles p ON m.sender_id = p.id
WHERE m.group_id = '<群组 UUID>'
ORDER BY m.created_at DESC
LIMIT 50;
```

#### 查询用户的群组列表

```sql
SELECT g.id, g.name, g.avatar_url, g.owner_id, gm.role
FROM public.group_members gm
JOIN public.groups g ON gm.group_id = g.id
WHERE gm.user_id = '<用户 UUID>';
```

#### 查询群成员列表

```sql
SELECT p.id, p.nickname, p.avatar_url, p.is_online, gm.role
FROM public.group_members gm
JOIN public.profiles p ON gm.user_id = p.id
WHERE gm.group_id = '<群组 UUID>'
ORDER BY gm.joined_at ASC;
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

-- 加速群聊消息查询
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON public.messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_created ON public.messages(group_id, created_at DESC);

-- 加速好友列表查询
CREATE INDEX IF NOT EXISTS idx_friendships_user_id
  ON public.friendships (user_id);

-- 加速群成员查询
CREATE INDEX IF NOT EXISTS idx_group_members_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON public.group_members(user_id);

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

## 4. Row Level Security (RLS) 全策略清单

### 4.1 什么是 RLS

Row Level Security 是 PostgreSQL 的行级安全机制。启用后，**即便用户通过了 API 网关的 JWT 认证，也只能看到/操作被策略允许的行**。

### 4.2 核心概念

| 概念 | 说明 |
|------|------|
| `auth.uid()` | PostgreSQL 函数，从当前请求的 JWT 中提取用户 UUID |
| `USING` | 控制**读取**（SELECT/UPDATE/DELETE）时的可见性 |
| `WITH CHECK` | 控制**写入**（INSERT/UPDATE）时的合法性 |
| `SECURITY DEFINER` | RPC 函数以创建者权限运行，绕过 RLS |

### 4.3 完整策略清单（共 17 条）

> 策略来源标注了对应 SQL 脚本编号，可据此溯源。

#### profiles 表（3 条）— 来源：01_init_database.sql

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

#### messages 表（3 条）— 来源：01+07+08

```sql
-- ④ 允许用户发送消息（sender_id 必须是自己，单聊需是好友、群聊需是群成员）
--    （来源：01_init，08_group_chat 中更新为包含群聊条件）
CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      (group_id IS NULL AND EXISTS (SELECT 1 FROM public.friendships f WHERE f.user_id = auth.uid() AND f.friend_id = receiver_id))
      OR
      (group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = messages.group_id AND gm.user_id = auth.uid()))
    )
  );

-- ⑤ 允许对话双方及群成员查看消息
--    （来源：01_init，08_group_chat 中更新为包含群聊条件）
CREATE POLICY "Users can view their conversations"
  ON public.messages FOR SELECT
  USING (
    auth.uid() = sender_id
    OR auth.uid() = receiver_id
    OR (
      group_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = messages.group_id
          AND gm.user_id = auth.uid()
      )
    )
  );

-- ⑥ 允许发送者更新自己发送的消息（用于撤回）
--    （来源：07_fix_revoke_realtime.sql）
CREATE POLICY "Users can update own messages"
  ON public.messages FOR UPDATE
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);
```

#### friendships 表（3 条）— 来源：01+03

```sql
-- ⑦ 允许用户查看自己的好友关系
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ⑧ 允许 RPC 函数插入（INSERT 由 add_friend RPC 的 SECURITY DEFINER 绕过）
CREATE POLICY "Users can insert own friendships"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ⑨ 允许用户删除自己的好友关系
CREATE POLICY "Users can delete own friendships"
  ON public.friendships FOR DELETE
  USING (auth.uid() = user_id);
```

#### groups 表（3 条）— 来源：08+09

```sql
-- ⑩ 所有人可查看群组信息（公开）
CREATE POLICY "Groups are viewable by everyone"
  ON public.groups FOR SELECT
  USING (true);

-- ⑪ 登录用户可创建群组
CREATE POLICY "Users can create groups"
  ON public.groups FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- ⑫ 群主可更新群组信息
CREATE POLICY "Owner can update group"
  ON public.groups FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ⑬ 群成员可更新群信息（来源：09_relax_group_permissions.sql）
CREATE POLICY "Members can update group info"
  ON public.groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = groups.id
        AND gm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = groups.id
        AND gm.user_id = auth.uid()
    )
  );
```

#### group_members 表（1 条）— 来源：08

```sql
-- ⑭ 所有人可查看群成员
CREATE POLICY "Group members are viewable by everyone"
  ON public.group_members FOR SELECT
  USING (true);
```

#### storage.objects（4 条）— 来源：04

```sql
-- ⑮ 允许所有人读取公开 Bucket
CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('chat-images', 'chat-files', 'chat-voice'));

-- ⑯ 仅允许已认证用户上传
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id IN ('chat-images', 'chat-files', 'chat-voice')
  );

-- ⑰ 允许已认证用户更新自己的文件
CREATE POLICY "Authenticated users can update own files"
  ON storage.objects FOR UPDATE
  USING (auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id IN ('chat-images', 'chat-files', 'chat-voice'));

-- ⑱ 允许已认证用户删除自己的文件
CREATE POLICY "Authenticated users can delete own files"
  ON storage.objects FOR DELETE
  USING (auth.uid()::text = (storage.foldername(name))[1]);
```

### 4.4 RLS 操作命令

**在 Studio 中管理**：`Authentication` → `Policies` → 选择表

```sql
-- 查看某表的所有策略
SELECT * FROM pg_policies WHERE tablename = 'messages';

-- 查看所有策略
SELECT tablename, policyname, cmd FROM pg_policies ORDER BY tablename, policyname;

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
WHERE schemaname = 'public' AND tablename IN ('profiles', 'messages', 'friendships', 'groups', 'group_members');

-- 2. 查看当前策略
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('profiles', 'messages', 'friendships', 'groups', 'group_members');

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
| 撤回消息失败 | `messages` 缺少 FOR UPDATE | `revokeMessage()` 被拒 |
| 群聊消息看不到 | `messages` SELECT 缺群成员条件 | 群聊窗口为空 |
| 无法创建群组 | `groups` 缺少 FOR INSERT | 建群失败 |
| 无法修改群名 | `groups` UPDATE 策略缺失 | 改群名失败 |

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

### 6.2 已启用 Realtime 发布的表

| 表 | 发布事件 | 来源脚本 |
|----|---------|---------|
| `messages` | INSERT, UPDATE | 01_init + 07_fix（UPDATE 需 REPLICA IDENTITY FULL） |
| `profiles` | UPDATE | 02_add_online_status |
| `groups` | INSERT, UPDATE | 08_group_chat |
| `group_members` | INSERT, DELETE | 08_group_chat |

### 6.3 手动管理 Realtime 发布

```sql
-- 查看当前发布中的表
SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- 启用表的 Realtime 发布
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- 禁用
ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
```

**验证**：Studio → `Database` → `Replication` → 查看 `supabase_realtime` 发布中的表列表。

### 6.4 前端订阅代码模式

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

### 6.5 实现要点

| 要点 | 说明 |
|------|------|
| **避免重复订阅** | `initRealtimeListener()` 须检查 `unsubscribeRealtime` 是否已存在 |
| **消息过滤** | 仅当 `sender_id` 或 `receiver_id` 匹配当前活跃聊天时才 push |
| **幂等性** | push 前 `Array.some()` 检查 `id` 是否已存在 |
| **生命周期** | `onMounted` 中订阅，`onUnmounted` 中取消 |
| **自动已读** | 收到对方消息且窗口可见时自动标记已读 |
| **撤回实时生效** | 必须 `REPLICA IDENTITY FULL`（见第 10 节） |

### 6.6 监控与调试

**查看活跃连接**：Studio → `Realtime` → 查看当前频道和客户端数

**排查不推送**：

```sql
-- 1. 确认表已加入发布
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- 2. 确认 REPLICA IDENTITY 设置
SELECT relname, relreplident FROM pg_class WHERE relname = 'messages';
-- relreplident = 'f' 表示 FULL, 'd' 表示 DEFAULT
```

```bash
# 查看 Realtime 日志
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

完整策略见 [第 4.3 节 storage.objects 部分](#storageobjects4-条来源04)。

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

> 完整 SQL 见 [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql)。

---

## 10. 消息撤回机制

### 10.1 数据模型

- `messages.is_revoked` (BOOLEAN, DEFAULT false)：标记消息是否已被撤回
- 撤回时仅更新 `is_revoked = true`，不删除记录。前端渲染时检测此字段显示"[消息已被撤回]"

> 字段创建 SQL：[06_add_is_revoked.sql](./06_add_is_revoked.sql)

### 10.2 Realtime 撤回推送的关键修复

默认情况下，PostgreSQL 的 `REPLICA IDENTITY DEFAULT` 仅将主键写入 WAL，导致 UPDATE 事件的 `payload.new` 可能不包含完整字段（如 `is_revoked`）。

**必须设置 REPLICA IDENTITY FULL**，确保接收者能实时收到撤回通知：

```sql
ALTER TABLE public.messages REPLICA IDENTITY FULL;
```

同时必须添加 messages 表的 UPDATE RLS 策略，允许发送者更新自己发送的消息：

```sql
CREATE POLICY "Users can update own messages"
  ON public.messages FOR UPDATE
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);
```

> 完整修复 SQL：[07_fix_revoke_realtime.sql](./07_fix_revoke_realtime.sql)

### 10.3 验证

```sql
-- 确认 REPLICA IDENTITY 为 FULL
SELECT relname, relreplident FROM pg_class WHERE relname = 'messages';
-- relreplident = 'f' 表示 FULL

-- 确认 UPDATE 策略存在
SELECT * FROM pg_policies WHERE tablename = 'messages' AND cmd = 'UPDATE';
```

### 10.4 前端撤回流程

1. 发送者右键消息 → 选择"撤回"
2. 前端调用 `chatService.revokeMessage(messageId)`
3. Service 层执行 `UPDATE messages SET is_revoked = true WHERE id = '<messageId>'`
4. Realtime 推送 UPDATE 事件给接收者
5. 接收者 Store 收到 UPDATE 事件后，原地更新对应消息的 `is_revoked` 字段
6. 接收者界面实时显示"[消息已被撤回]"

---

## 11. 文件元数据字段

### 11.1 用途

为了让文件消息（`msg_type` = `file` / `image` / `voice`）能够在聊天界面显示**原始文件名**和**友好文件大小**，`messages` 表新增两个字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `file_name` | TEXT | 原始文件名，仅 file/image/voice 类型消息使用 |
| `file_size` | BIGINT | 文件字节数，前端用于展示友好文件大小 |

> 创建 SQL：[05_add_file_metadata.sql](./05_add_file_metadata.sql)

### 11.2 前端使用

发送文件消息时，在 `messages` 记录中同时写入：

```ts
await chatService.sendMessage({
  sender_id: userId,
  receiver_id: friendId,
  content: fileUrl,       // Supabase Storage URL
  msg_type: 'file',
  file_name: '周报_2024Q4.docx',
  file_size: 2048576,     // 约 2MB
})
```

渲染时根据 `file_name` 和 `file_size` 显示文件卡片（带下载图标、文件名、大小）。

---

## 12. 群聊系统

### 12.1 数据模型

群聊系统由两张新表 + `messages` 表扩展字段组成：

#### groups 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 群组 ID |
| `name` | TEXT (NOT NULL) | 群组名称 |
| `avatar_url` | TEXT | 群头像 URL |
| `owner_id` | UUID (FK→profiles.id) | 群主用户 ID |
| `created_at` | TIMESTAMPTZ | 创建时间 |

#### group_members 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | 记录 ID |
| `group_id` | UUID (FK→groups.id) | 群组 ID |
| `user_id` | UUID (FK→profiles.id) | 成员用户 ID |
| `role` | TEXT | `owner`（群主）/ `admin`（管理员）/ `member`（普通成员） |
| `joined_at` | TIMESTAMPTZ | 加入时间 |

- **唯一约束**：`UNIQUE(group_id, user_id)` 防止重复加入
- **级联删除**：删除群组时自动清理所有成员关系和消息

#### messages 表扩展

| 字段 | 类型 | 说明 |
|------|------|------|
| `group_id` | UUID (FK→groups.id) | 群聊消息对应的群组 ID，单聊时为 NULL |

- 群聊消息：`group_id` 非空，`receiver_id` 设为 `sender_id`（满足 FK 约束）
- 单聊消息：`group_id` 为 NULL，行为完全不变

> 完整建表 SQL：[08_group_chat.sql](./08_group_chat.sql)

### 12.2 RPC 函数清单

群聊系统通过以下 5 个 SECURITY DEFINER RPC 函数操作，绕过 RLS 限制：

| RPC 函数 | 用途 | 权限要求 | 来源 |
|---------|------|---------|------|
| `create_group(name, member_ids)` | 创建群组 + 群主加入 + 拉初始成员 | 登录用户 | 08 |
| `add_group_member(group_id, user_id)` | 拉人进群 | **任何群成员**（09 放宽后） | 08→09 |
| `remove_group_member(group_id, user_id)` | 退出群聊 / 踢人 | 自己退出任意成员均可；踢人需群主/管理员 | 08 |
| `dissolve_group(group_id)` | 解散群组 | 仅群主 | 08 |
| `update_group_name(group_id, name)` | 修改群名 | **任何群成员**（09 新增） | 09 |

### 12.3 create_group RPC

```sql
CREATE OR REPLACE FUNCTION public.create_group(
  p_name TEXT,
  p_member_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id UUID;
  v_owner_id UUID;
  v_member_id UUID;
  v_result JSONB;
BEGIN
  v_owner_id := auth.uid();

  -- 1. 创建群组
  INSERT INTO public.groups (name, owner_id)
  VALUES (p_name, v_owner_id)
  RETURNING id INTO v_group_id;

  -- 2. 群主加入 group_members
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group_id, v_owner_id, 'owner');

  -- 3. 添加其他成员
  FOREACH v_member_id IN ARRAY p_member_ids
  LOOP
    IF v_member_id != v_owner_id THEN
      INSERT INTO public.group_members (group_id, user_id, role)
      VALUES (v_group_id, v_member_id, 'member');
    END IF;
  END LOOP;

  -- 返回创建的群组信息
  SELECT jsonb_build_object(
    'id', g.id, 'name', g.name, 'avatar_url', g.avatar_url,
    'owner_id', g.owner_id, 'created_at', g.created_at
  ) INTO v_result
  FROM public.groups g WHERE g.id = v_group_id;

  RETURN v_result;
END;
$$;
```

### 12.4 add_group_member RPC（09 放宽版）

**原始版本**（08）：仅群主和管理员可拉人  
**放宽版本**（09）：**任何群成员**均可邀请他人进群

```sql
CREATE OR REPLACE FUNCTION public.add_group_member(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 检查调用者是否为群成员（任何角色均可邀请）
  SELECT gm.role INTO v_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION '你不是该群成员，无法邀请';
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (p_group_id, p_user_id, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;
```

### 12.5 remove_group_member RPC

支持两种操作：
- **自己退出**（`p_user_id = auth.uid()`）：任何成员均可，群主不能直接退出
- **踢人**（`p_user_id != auth.uid()`）：群主可踢任何人，管理员可踢普通成员

```sql
CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  -- 获取调用者角色
  SELECT gm.role INTO v_caller_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid();

  -- 自己退出群聊
  IF p_user_id = auth.uid() AND v_caller_role IS NOT NULL THEN
    IF v_caller_role = 'owner' THEN
      RAISE EXCEPTION '群主不能直接退出，请先转让群主或解散群';
    END IF;
    DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
    RETURN jsonb_build_object('success', true, 'action', 'leave');
  END IF;

  -- 踢人：权限检查
  SELECT gm.role INTO v_target_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id;

  IF v_caller_role = 'owner' OR (v_caller_role = 'admin' AND v_target_role = 'member') THEN
    DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
    RETURN jsonb_build_object('success', true, 'action', 'kick');
  ELSE
    RAISE EXCEPTION '没有踢人权限';
  END IF;
END;
$$;
```

### 12.6 dissolve_group RPC

仅群主可解散群组（CASCADE 自动清理 group_members 和 messages）：

```sql
CREATE OR REPLACE FUNCTION public.dissolve_group(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION '仅群主可以解散群';
  END IF;

  DELETE FROM public.groups WHERE id = p_group_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
```

### 12.7 update_group_name RPC（09 新增）

任何群成员均可修改群名：

```sql
CREATE OR REPLACE FUNCTION public.update_group_name(
  p_group_id UUID,
  p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
  ) INTO v_member_exists;

  IF NOT v_member_exists THEN
    RAISE EXCEPTION '你不是该群成员，无法修改群名';
  END IF;

  UPDATE public.groups SET name = p_name WHERE id = p_group_id;
  RETURN jsonb_build_object('success', true, 'name', p_name);
END;
$$;
```

### 12.8 前端调用示例

```ts
// 创建群组
const group = await supabase.rpc('create_group', {
  p_name: '项目组群聊',
  p_member_ids: [friendId1, friendId2]
})

// 邀请入群
await supabase.rpc('add_group_member', {
  p_group_id: groupId,
  p_user_id: newMemberId
})

// 退出群聊
await supabase.rpc('remove_group_member', {
  p_group_id: groupId,
  p_user_id: currentUserId
})

// 踢人
await supabase.rpc('remove_group_member', {
  p_group_id: groupId,
  p_user_id: targetUserId
})

// 解散群组
await supabase.rpc('dissolve_group', { p_group_id: groupId })

// 修改群名
await supabase.rpc('update_group_name', {
  p_group_id: groupId,
  p_name: '新群名'
})
```

### 12.9 Realtime 群成员感知

`groups` 和 `group_members` 表已加入 Realtime 发布，前端可通过订阅以下事件实现实时感知：

- `group_members` INSERT：有新人被拉入群聊
- `group_members` DELETE：有人退出/被踢出群聊
- `groups` UPDATE：群信息变更（如群名修改）

> 完整建表 SQL：[08_group_chat.sql](./08_group_chat.sql)  
> 权限放宽 SQL：[09_relax_group_permissions.sql](./09_relax_group_permissions.sql)

---

## 13. 备份与恢复

### 13.1 Supabase CLI 备份

```bash
# 导出完整数据库（含结构 + 数据 + RLS）
supabase db dump --local --data-only > backup_data_$(date +%Y%m%d).sql

# 仅导出表结构
supabase db dump --local --schema-only > backup_schema.sql

# 导出特定表
supabase db dump --local --data-only --table public.messages > backup_messages.sql
```

### 13.2 pg_dump 直接导出

```bash
pg_dump -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  --table='public.profiles' \
  --table='public.friendships' \
  --table='public.messages' \
  --table='public.groups' \
  --table='public.group_members' \
  > full_backup.sql
```

### 13.3 恢复

```bash
# 方式一：Supabase CLI
supabase db restore backup.sql

# 方式二：psql 直接执行
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f backup.sql
```

### 13.4 Docker Volume 备份

```bash
# 查看 Volume 名称
docker volume ls | grep supabase

# 备份
docker run --rm -v supabase_db_data:/data -v $(pwd):/backup alpine tar czf /backup/db_volume_backup.tar.gz -C /data .

# 恢复
docker run --rm -v supabase_db_data:/data -v $(pwd):/backup alpine tar xzf /backup/db_volume_backup.tar.gz -C /data
```

### 13.5 生产备份策略建议

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

## 14. 内网生产部署

### 14.1 部署架构

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

### 14.2 镜像离线迁移

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

### 14.3 修改生产配置

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

### 14.4 防火墙配置

| 端口 | 用途 | 访问范围 |
|------|------|---------|
| `54321` | API 网关（客户端连接） | 内网全部 |
| `54323` | Studio 管理面板 | 仅管理员 |
| `54322` | PostgreSQL 直连 | 仅服务器本地 |

```bash
# Windows 防火墙示例
netsh advfirewall firewall add rule name="Supabase API" dir=in action=allow protocol=tcp localport=54321
```

### 14.5 客户端配置

修改 `client-chat-tauri/.env.production`：

```env
VITE_SUPABASE_URL=http://<内网服务器IP>:54321
VITE_SUPABASE_ANON_KEY=<生产环境 Publishable Key>
VITE_BACKEND_TYPE=SUPABASE
```

> **注意**：URL 末尾不加 `/`；不要写成 PostgreSQL 端口 `54322`。

### 14.6 开机自启（Linux systemd）

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

## 15. 常用 CLI 命令速查

### 15.1 生命周期

```bash
supabase init          # 初始化
supabase start         # 启动
supabase stop          # 停止（保留数据）
supabase stop --no-backup  # 停止并清空
supabase status        # 查看运行状态
```

### 15.2 数据库

```bash
supabase db diff --linked --file <name>  # 生成迁移文件
supabase db push                         # 推送迁移
supabase db reset                        # 重置（清空所有数据）
supabase db dump --local --data-only     # 导出数据
supabase db dump --local --schema-only   # 导出结构
```

### 15.3 日志

```bash
supabase logs                     # 所有服务
supabase logs --type auth         # GoTrue
supabase logs --type rest         # PostgREST
supabase logs --type realtime     # Realtime
supabase logs --type db           # PostgreSQL
supabase logs --tail 100          # 最近 100 行
```

### 15.4 容器管理

```bash
docker ps --filter "name=supabase"              # 查看容器状态
docker restart supabase_db_supabase             # 重启单个容器
docker logs supabase_kong_supabase --tail 50    # 查看容器日志
docker exec -it supabase_db_supabase psql -U postgres  # 进入 PostgreSQL
```

---

## 16. 故障排查指南

### 16.1 `supabase start` 卡住

```bash
# 检查 Docker
docker info

# 手动拉取镜像
docker pull public.ecr.aws/supabase/postgres:15.6.1.113
```

### 16.2 容器不断重启

```bash
docker logs supabase_db_supabase --tail 100
docker logs supabase_auth_supabase --tail 100
```

### 16.3 注册失败：`Database error`

1. `profiles` 表不存在 → 执行 [01_init_database.sql](./01_init_database.sql)
2. `profiles` 缺少 INSERT 策略 → 检查 RLS 策略
3. `auth.users` 表损坏 → `supabase db reset`

### 16.4 查询返回空数组

```sql
-- 1. 确认数据存在
SELECT COUNT(*) FROM public.messages;

-- 2. 确认 RLS 策略
SELECT * FROM pg_policies WHERE tablename = 'messages';

-- 3. 模拟用户身份测试
SELECT set_config('request.jwt.claim.sub', '<用户UUID>', false);
SELECT * FROM public.messages;
```

### 16.5 外键约束错误

```
ERROR: insert or update on table "messages" violates foreign key constraint
```

**原因**：`sender_id` 或 `receiver_id` 对应的 `profiles` 记录不存在。  
**解决**：确认用户已在 `profiles` 表中有记录。

### 16.6 登录成功但 profiles 查询失败

```sql
-- 手动补全缺失的 profiles
INSERT INTO public.profiles (id, nickname, employee_id)
SELECT id, email, '0000000'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);
```

### 16.7 Realtime 不推送

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

### 16.8 收到重复消息

**原因**：多次调用 `initRealtimeListener()` 导致重复订阅。  
**解决**：订阅前检查并移除旧订阅。

### 16.9 Storage 上传失败

1. Bucket 是否已创建？（执行 [04_init_storage_buckets.sql](./04_init_storage_buckets.sql)）
2. Bucket 是否设为公开？
3. 文件是否超大小限制？
4. Storage RLS 策略是否正确？

### 16.10 文件 URL 无法访问（头像裂图）

**原因**：Bucket 未设为公开，或 URL 格式错误，或 Storage 文件已丢失（Docker 数据卷重建）。  
**正确格式**：`http://127.0.0.1:54321/storage/v1/object/public/<bucket>/<path>`  
**解决**：重新上传文件，生成新的有效 URL。

### 16.11 客户端始终显示"离线"

1. 确认 [02_add_online_status.sql](./02_add_online_status.sql) 已执行
2. 检查 `profiles.is_online` 字段是否存在
3. 检查 `go_online()` / `go_offline()` RPC 函数是否存在
4. 检查 `profiles` 表是否已加入 Realtime 发布

### 16.12 添加好友失败

1. 确认 [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) 已执行
2. 确认 `add_friend` RPC 函数存在
3. 确认 `uq_friendship_pair` 唯一约束存在（防止重复添加）
4. 确认目标用户在 `profiles` 表中存在

### 16.13 撤回消息不实时生效

1. 确认 [06_add_is_revoked.sql](./06_add_is_revoked.sql) 和 [07_fix_revoke_realtime.sql](./07_fix_revoke_realtime.sql) 已执行
2. 检查 `messages.is_revoked` 字段是否存在
3. 检查 `REPLICA IDENTITY FULL` 是否设置：
   ```sql
   SELECT relname, relreplident FROM pg_class WHERE relname = 'messages';
   ```
   （`relreplident = 'f'` 表示 FULL）
4. 检查 messages 表是否有 UPDATE RLS 策略

### 16.14 群聊功能异常

1. 确认 [08_group_chat.sql](./08_group_chat.sql) 已执行（groups / group_members 表存在）
2. 确认 [09_relax_group_permissions.sql](./09_relax_group_permissions.sql) 已执行（RPC 为放宽版）
3. 检查群聊 RPC 函数是否存在：
   ```sql
   SELECT proname FROM pg_proc WHERE proname IN (
     'create_group', 'add_group_member', 'remove_group_member', 'dissolve_group', 'update_group_name'
   );
   ```
4. 检查 RLS 策略：
   ```sql
   SELECT * FROM pg_policies WHERE tablename IN ('groups', 'group_members', 'messages');
   ```

---

## 17. 附录：PostgreSQL 常用查询

### 17.1 系统信息

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

-- 查看 REPLICA IDENTITY 设置
SELECT relname, relreplident FROM pg_class
WHERE relname IN ('messages', 'profiles', 'groups', 'group_members');
```

### 17.2 数据统计

```sql
-- 各表行数
SELECT 'profiles' AS tbl, COUNT(*) FROM public.profiles
UNION ALL
SELECT 'friendships', COUNT(*) FROM public.friendships
UNION ALL
SELECT 'messages', COUNT(*) FROM public.messages
UNION ALL
SELECT 'groups', COUNT(*) FROM public.groups
UNION ALL
SELECT 'group_members', COUNT(*) FROM public.group_members;

-- 各用户消息数
SELECT p.nickname, COUNT(*) AS msg_count
FROM public.messages m
JOIN public.profiles p ON m.sender_id = p.id
GROUP BY p.nickname
ORDER BY msg_count DESC;

-- 在线用户数
SELECT COUNT(*) AS online_count FROM public.profiles WHERE is_online = true;

-- 群组成员统计
SELECT g.name, COUNT(gm.user_id) AS member_count
FROM public.groups g
LEFT JOIN public.group_members gm ON g.id = gm.group_id
GROUP BY g.id, g.name
ORDER BY member_count DESC;

-- 数据库总大小
SELECT pg_size_pretty(pg_database_size('postgres'));
```

### 17.3 清理与维护

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
| [环境搭建与启动指南](./app-chat环境搭建与启动指南.md) | 首次启动与测试清单 | 环境要求变化、启动流程调整 |
| [前端 API 调用参考](./app-chat前端API调用参考.md) | 前端 SDK 调用细节 | `chatService.ts` 新增/修改方法 |
| [Go 后端接口对齐图纸](./app-chat后端Go接口对齐图纸.md) | Go 后端接口对应关系 | Go 后端接口变更 |
| SQL 脚本（01-09） | 数据库迁移脚本 | 表结构变更 |

> **提示**：遇到 Supabase 问题先查阅本文档第 16 节故障排查；环境搭建问题查阅启动指南；前端调用细节查阅 API 参考。
