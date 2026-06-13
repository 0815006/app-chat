# Release Notes — v1.0.0 首次全版本交付

> **发布日期**：2026-06-13  
> **代号**：Genesis — 内网私有化企业 IM 底座  
> **产品名**：app-chat (Chat)

---

## 1. 交付范围总览

| 组件 | 版本 | 说明 |
|------|------|------|
| **Tauri 桌面客户端** | v1.0.0 | Windows .exe / .msi 安装包 |
| **Supabase 后端（一期）** | 本地 Docker | PostgreSQL + Realtime + Storage |
| **Go 后端（二期）** | v1.0.0 | Gin + WebSocket + GORM + MySQL + Redis |
| **数据库迁移脚本** | 01 ~ 09 | 完整建表、RLS、RPC、Realtime 配置 |

---

## 2. 技术栈

### 客户端

| 层级 | 技术选型 |
|------|---------|
| 桌面框架 | Tauri 2.x (Rust + WebView2) |
| 前端框架 | Vue 3 + TypeScript + `<script setup>` |
| 构建工具 | Vite |
| UI 样式 | Tailwind CSS（手绘 Discord 暗黑风格） |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |

### 后端

| 阶段 | 后端 | 核心依赖 |
|------|------|---------|
| 一期（默认） | Supabase（本地 Docker） | GoTrue, PostgREST, Realtime, Storage |
| 二期（可切换） | Go 自建后端 | Gin, Melody (WebSocket), GORM, MySQL, Redis (可选) |

---

## 3. 一期交付功能清单

### 3.1 用户认证

| # | 功能 | 说明 |
|---|------|------|
| 1 | 邮箱注册 | 支持邮箱 + 密码注册，注册时填写 7 位工号 + 昵称 |
| 2 | 邮箱登录 | 支持邮箱 + 密码登录 |
| 3 | 会话持久化 | 关闭窗口后自动恢复登录态（localStorage cache） |
| 4 | 路由守卫 | 未登录自动跳转 `/login` |
| 5 | 免邮件确认 | 内网环境 `GOTRUE_MAILER_AUTOCONFIRM=true`，注册即激活 |

### 3.2 好友管理

| # | 功能 | 说明 |
|---|------|------|
| 6 | 搜索用户 | 按工号 / 昵称搜索已注册用户 |
| 7 | 添加好友 | 点击"添加好友"按钮搜索并发送请求 |
| 8 | 删除好友 | 右键好友列表项删除（双向关系同步删除） |
| 9 | 好友列表 | 显示昵称、工号、头像、在线状态（绿点） |
| 10 | 在线状态 | `profiles.is_online` 实时更新（绿点/灰点） |

### 3.3 单聊消息

| # | 功能 | 说明 |
|---|------|------|
| 11 | 发送文本 | 输入框输入文字 → Enter 发送 |
| 12 | 实时接收 | Supabase Realtime WebSocket 实时推送新消息 |
| 13 | 历史消息 | 切换好友自动加载历史对话（分页加载） |
| 14 | 消息对齐 | 自己消息靠右（蓝绿渐变），他人消息靠左（深灰） |
| 15 | 时间戳 | 每条消息显示 HH:mm，间隔 > 5 分钟插入时间分隔线 |
| 16 | 自动滚底 | 新消息到达自动滚动到底部 |
| 17 | 未读计数 | 离线消息未读数统计 |

### 3.4 群聊

| # | 功能 | 说明 |
|---|------|------|
| 18 | 创建群组 | 选择好友创建群聊，群主自动加入 |
| 19 | 群消息 | 支持群聊文本消息，所有群成员实时接收 |
| 20 | 邀请入群 | **任何群成员**均可邀请他人入群 |
| 21 | 退出群聊 | 任何成员可退出（群主不能直接退） |
| 22 | 踢人 | 群主可踢任何人，管理员可踢普通成员 |
| 23 | 解散群组 | 仅群主可操作，CASCADE 清理消息和成员 |
| 24 | 修改群名 | 任何群成员均可修改群名 |
| 25 | 群成员感知 | 新成员被邀请/退出时实时刷新群成员列表 |

### 3.5 文件与多媒体

| # | 功能 | 说明 |
|---|------|------|
| 26 | 图片消息 | 上传到 Supabase Storage，聊天窗内渲染 |
| 27 | 文件消息 | 支持文件上传下载，显示文件名和大小 |
| 28 | 语音消息 | 支持语音条上传和播放 |
| 29 | 文件元数据 | `file_name` + `file_size` 持久化存储 |
| 30 | 本地打开文件 | 右键消息 → "打开文件" 调用系统默认程序 |
| 31 | 在文件夹中显示 | 右键消息 → "在文件夹中显示" 打开资源管理器 |

### 3.6 消息撤回

| # | 功能 | 说明 |
|---|------|------|
| 32 | 撤回消息 | 右键自己发送的消息 → "撤回" |
| 33 | 实时生效 | 接收者界面实时显示"[消息已被撤回]" |
| 34 | 撤回降级 | 跨设备通过服务器级客户端时间戳比较自动降级 |

### 3.7 桌面交互

| # | 功能 | 说明 |
|---|------|------|
| 35 | 自定义标题栏 | 自绘最小化/最大化/关闭按钮 |
| 36 | 系统托盘 | 关闭窗口缩至托盘，双击/右键"显示主窗口"恢复 |
| 37 | 原生通知 | 收到新消息且窗口未聚焦时弹出 Windows 原生通知 |
| 38 | 窗口闪烁 | 新消息触发任务栏图标闪烁 |
| 39 | 键盘快捷键 | Escape（取消激活）、Ctrl+N（新建聊天）、Ctrl+F（搜索好友） |
| 40 | 右键菜单 | 消息气泡上定制右键菜单（复制/撤回/打开文件/在文件夹中显示）；全局禁用浏览器菜单（WebView2 默认菜单阻止） |

### 3.8 弹窗交互

| # | 功能 | 说明 |
|---|------|------|
| 41 | 添加好友弹窗 | 搜索用户并添加 |
| 42 | 创建群组弹窗 | 选择好友并建群 |
| 43 | 个人信息弹窗 | 点击头像查看/编辑个人信息 |
| 44 | 群成员面板 | 查看群成员列表、踢人、邀请 |
| 45 | Toast 通知 | 自研轻量 toast（success / error / warning / info） |

### 3.9 后端双轨切换

| # | 功能 | 说明 |
|---|------|------|
| 46 | Supabase 后端 | 一期默认，`VITE_BACKEND_TYPE=SUPABASE` |
| 47 | Go 后端 | 二期，`VITE_BACKEND_TYPE=GO` |
| 48 | 编译时隔离 | SUPABASE 模式下不构造 Go 适配器，不启动 WebSocket |
| 49 | 适配器模式 | UI 层零改动 —— Service 层通过 `IChatService` 接口实现切换 |

---

## 4. 数据库结构

### 4.1 表清单

| 表 | 用途 | 主键 |
|----|------|------|
| `profiles` | 用户公开资料（含在线状态） | UUID |
| `friendships` | 好友关系（双向存储） | UUID |
| `messages` | 聊天消息（含群聊、撤回） | UUID |
| `groups` | 群组信息 | UUID |
| `group_members` | 群成员关系 | UUID |

### 4.2 迁移脚本（按执行顺序）

| # | 脚本 | 职责 |
|---|------|------|
| 1 | [`01_init_database.sql`](./01_init_database.sql) | 建表、注释、7 条基础 RLS、Realtime 发布（messages） |
| 2 | [`02_add_online_status.sql`](./02_add_online_status.sql) | 在线状态字段 + `go_online()`/`go_offline()` RPC + Realtime（profiles） |
| 3 | [`03_fix_friendship_rls.sql`](./03_fix_friendship_rls.sql) | `add_friend()`/`remove_friend()` RPC + 唯一约束 + DELETE RLS |
| 4 | [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql) | 3 个 Storage bucket（chat-images/chat-files/chat-voice）+ RLS |
| 5 | [`05_add_file_metadata.sql`](./05_add_file_metadata.sql) | `file_name` + `file_size` 字段 |
| 6 | [`06_add_is_revoked.sql`](./06_add_is_revoked.sql) | `is_revoked` 撤回字段 |
| 7 | [`07_fix_revoke_realtime.sql`](./07_fix_revoke_realtime.sql) | `REPLICA IDENTITY FULL` + UPDATE RLS 策略 |
| 8 | [`08_group_chat.sql`](./08_group_chat.sql) | `groups`/`group_members` 建表 + 4 个 RPC + RLS + Realtime |
| 9 | [`09_relax_group_permissions.sql`](./09_relax_group_permissions.sql) | 放宽群权限（任何人可邀请/改群名）+ `update_group_name` RPC |

### 4.3 RLS 策略总数：18 条

| 表 | 策略数 |
|----|--------|
| `profiles` | 3 |
| `messages` | 3 |
| `friendships` | 3 |
| `groups` | 4 |
| `group_members` | 1 |
| `storage.objects` | 4 |

---

## 5. Go 后端（二期）交付内容

### 5.1 API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/register` | POST | 用户注册 |
| `/api/login` | POST | 登录并获取 JWT |
| `/api/profile` | GET | 获取当前用户资料 |
| `/api/profile` | PUT | 更新用户资料 |
| `/api/search-users` | GET | 搜索用户 |
| `/api/friends` | GET | 好友列表 |
| `/api/friends/add` | POST | 添加好友 |
| `/api/friends/remove` | POST | 删除好友 |
| `/api/history` | GET | 获取历史消息 |
| `/api/upload` | POST | 文件上传 |
| `/api/groups` | POST | 创建群组 |
| `/api/groups` | GET | 我的群组列表 |
| `/api/groups/:id/members` | GET | 群成员列表 |
| `/api/groups/:id/members` | POST | 邀请入群 |
| `/api/groups/:id/members` | DELETE | 退出群聊 |
| `/api/groups/:id` | PUT | 修改群名 |
| `/api/groups/:id` | DELETE | 解散群组 |
| `/api/messages/:id/revoke` | POST | 撤回消息 |
| `/ws` | WebSocket | 实时消息长连接 |

### 5.2 核心能力

- **JWT 鉴权**：72 小时过期，WebSocket 连接时通过 Query 参数携带 Token
- **GORM AutoMigrate**：启动时自动建表/更新字段
- **Redis 弹性降级**：`config.yaml` 中 `redis.enable` 控制，关闭后纯 MySQL 模式持稳运行
- **IM 长连接管理**：Hub 模式，channel + select 消息路由，在线直推 / 离线缓冲
- **文件上传**：本地目录 `./uploads/`，按用户 ID 分目录存储

### 5.3 部署支持

| 平台 | 方案 |
|------|------|
| **Windows** | WinSW 注册为系统服务（`services.msc` 管理，开机自启） |
| **Linux** | systemd 托管（`chat-server.service`，崩溃自动重启） |
| **交叉编译** | Windows 上直接 `$env:GOOS="linux"` 打出 Linux 二进制 |

---

## 6. 文档体系

| 文档 | 路径 | 用途 |
|------|------|------|
| 环境搭建与启动指南 | [`docs/app-chat环境搭建与启动指南.md`](./app-chat环境搭建与启动指南.md) | 首次启动、测试清单、Go 后端部署 |
| Supabase 运维手册 | [`docs/Supabase运维手册.md`](./Supabase运维手册.md) | 数据库管理、RLS 策略、故障排查 |
| 前端 API 调用参考 | [`docs/app-chat前端API调用参考.md`](./app-chat前端API调用参考.md) | Service 层接口说明 |
| Go 后端接口对齐图纸 | [`docs/app-chat后端Go接口对齐图纸.md`](./app-chat后端Go接口对齐图纸.md) | Go 后端接口前后端对应关系 |
| SQL 迁移脚本 | [`docs/01-09_*.sql`](./) | 数据库版本化管理 |

---

## 7. 已知问题

| # | 问题 | 影响 | 计划修复版本 |
|---|------|------|------------|
| 1 | 头像裂图（Storage 文件丢失，Docker 数据卷重建后） | 偶尔出现，重新上传恢复 | 后续改进稳定性 |
| 2 | Go 后端 Redis 关闭时在线状态仅内存级别（不跨进程） | 多实例部署场景 | 后续优化 |
| 3 | WebView2 右键菜单默认弹出（已通过 `main.ts` 全局阻止修复） | 无 | v1.0.0 已修复 |

---

## 8. 编译与打包

### 客户端

```bash
cd client-chat-tauri
npm install
npm run tauri build
# 产物：.msi 安装包 + .exe 绿色版
```

### Go 后端

```bash
# Windows
go build -ldflags "-s -w" -o go-chat-server.exe main.go

# Linux 交叉编译
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags "-s -w" -o go-chat-server main.go
```

---

## 9. 致谢与里程碑

首个个人全栈windows应用，作者：cd5403

```
📦  v1.0.0 Genesis — 内网私有化企业 IM 底座
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 17 条 RLS 策略                 ████████████████████
✅ 9 个 SQL 迁移脚本              ████████████████████
✅ 5 张业务表                     ████████████████████
✅ 5 个 RPC 函数（好友+群聊）       ████████████████████
✅ 46+ 业务功能点                  ████████████████████
✅ 双后端架构（Supabase ⇄ Go）     ████████████████████
✅ 跨平台部署（WinSW + systemd）   ████████████████████
✅ 5 份完整文档                    ████████████████████
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> 下一个里程碑目标：v1.1.0 — 消息已读回执、群组头像、消息搜索、性能优化。
