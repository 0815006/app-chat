# 环境搭建与启动指南

> 适用版本：一期（Tauri + Vue 3 + Supabase）→ 二期（Tauri + Vue 3 + Go 后端）  
> 配套文档：[Supabase 运维手册](./Supabase运维手册.md) | [前端 API 调用参考](./前端API调用参考.md) | [Go 后端接口对齐图纸](./Go后端接口对齐图纸.md)  
> 配套 SQL 脚本：
> - [01_init_database.sql](./01_init_database.sql) — 建表 + RLS + Realtime
> - [02_add_online_status.sql](./02_add_online_status.sql) — 在线状态
> - [03_fix_friendship_rls.sql](./03_fix_friendship_rls.sql) — 好友 RPC 函数
> - [04_init_storage_buckets.sql](./04_init_storage_buckets.sql) — Storage 存储桶

---

## 目录

- [第一部分：一期 Supabase 后端环境](#第一部分一期-supabase-后端环境)
  - [1. 环境要求](#1-环境要求)
  - [2. 首次启动](#2-首次启动)
  - [3. 初始化数据库](#3-初始化数据库)
  - [4. 启动开发服务器](#4-启动开发服务器)
  - [5. 功能测试清单](#5-功能测试清单)
  - [6. 常见问题](#6-常见问题)
  - [附录A：Tauri 客户端右键菜单问题](#附录atauri-客户端右键菜单问题)
- [第二部分：二期 Go 后端环境](#第二部分二期-go-后端环境)
  - [7. Go 后端开发环境](#7-go-后端开发环境)
  - [8. Go 后端 Windows 部署（WinSW 方案）](#8-go-后端-windows-部署winsw-方案)
  - [9. Go 后端 Linux 部署（systemd 方案）](#9-go-后端-linux-部署systemd-方案)
  - [10. 前端切换到 Go 后端](#10-前端切换到-go-后端)

---

# 第一部分：一期 Supabase 后端环境

## 1. 环境要求

| 工具 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | >= 18 | Vue 3 + Vite 前端 |
| npm | >= 9 | 包管理 |
| Rust | >= 1.77 (stable) | Tauri 桌面端编译 |
| Cargo | >= 1.77 | Rust 包管理器 |
| Docker Desktop | >= 24 | 运行本地 Supabase 容器 |
| Supabase CLI | >= 1.100 | 管理 Supabase 实例 |

### 安装 Supabase CLI

```bash
npm install -g supabase
supabase --version  # 验证
```

### 安装 Rust 工具链（Tauri 编译必需）

```bash
# Windows：下载 rustup-init.exe → https://rustup.rs
# 安装时选择 "1) Proceed with installation (default)"
rustc --version   # 验证 Rust
cargo --version   # 验证 Cargo
```

---

## 2. 首次启动

### 2.1 安装前端依赖

```bash
cd client-chat-tauri
npm install
```

### 2.2 启动本地 Supabase

```bash
cd d:\GitHub\app-chat
supabase start
```

首次启动会自动拉取 Docker 镜像（约 2~5 分钟），等待输出：

```
Started supabase local development setup.
```

启动成功后的关键连接信息：

| 服务 | 本地地址 | 说明 |
|------|----------|------|
| Studio (管理面板) | `http://127.0.0.1:54323` | 可视化管理 |
| Kong API 网关 | `http://127.0.0.1:54321` | **前端 SDK 连接地址** |
| PostgreSQL | `127.0.0.1:54322` | 数据库直连 |
| Publishable Key | `sb_publishable_...` | **写入 `.env.development`** |

### 2.3 配置环境变量

确认 `client-chat-tauri/.env.development`：

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<启动日志中的 Publishable Key>
VITE_BACKEND_TYPE=SUPABASE
VITE_GO_BASE_URL=http://127.0.0.1:8194
VITE_GO_WS_URL=ws://127.0.0.1:8194/ws
```

> **注意**：
> - `VITE_SUPABASE_URL` 是 Kong API 网关端口（54321），不是 PostgreSQL 端口（54322）。
> - `VITE_BACKEND_TYPE` 取值必须为大写 `SUPABASE` 或 `GO`。
> - Go 后端变量（`VITE_GO_*`）一期可不填，二期切换时启用。

### 2.4 验证容器运行状态

```bash
docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Status}}"
```

预期 12 个容器状态均为 `Up` 或 `healthy`。

---

## 3. 初始化数据库

> **SQL 脚本已按序号命名，必须按顺序执行。** 每个脚本职责如下：

| # | 文件名 | 职责 | 执行方式 |
|---|--------|------|---------|
| 1 | [`01_init_database.sql`](./01_init_database.sql) | 建表、字段注释、RLS 策略、Realtime 发布 | Studio SQL Editor |
| 2 | [`02_add_online_status.sql`](./02_add_online_status.sql) | 在线状态字段 + RPC 函数 | Studio SQL Editor |
| 3 | [`03_fix_friendship_rls.sql`](./03_fix_friendship_rls.sql) | 好友添加/删除 RPC + 唯一约束 + DELETE 策略 | Studio SQL Editor |
| 4 | [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql) | Storage 存储桶 + RLS 策略 | Studio SQL Editor |

### 3.1 打开 Supabase Studio

浏览器访问：`http://127.0.0.1:54323`

### 3.2 执行建表 SQL（脚本 01）

Studio 左侧菜单 → **SQL Editor** → 新建查询 → 粘贴 [`01_init_database.sql`](./01_init_database.sql) 的全部内容 → 点击 **Run**。

该脚本会一次性完成：
- 创建 3 张业务表（`profiles`, `friendships`, `messages`）
- 添加字段注释
- 配置 7 条 RLS 安全策略
- 开启 `messages` 表的 Realtime 实时发布

### 3.3 执行其余 SQL 脚本

按序号依次执行 `02` → `03` → `04` 脚本：

- **02** [`02_add_online_status.sql`](./02_add_online_status.sql)：为 `profiles` 表添加 `is_online` 字段，创建 `go_online()` / `go_offline()` RPC 函数，将 `profiles` 加入 Realtime 发布
- **03** [`03_fix_friendship_rls.sql`](./03_fix_friendship_rls.sql)：创建 `add_friend()` / `remove_friend()` RPC 函数（自动双向插入/删除），添加 `friendships` 唯一约束和 DELETE 策略
- **04** [`04_init_storage_buckets.sql`](./04_init_storage_buckets.sql)：创建 3 个 Storage 存储桶（`chat-images`、`chat-files`、`chat-voice`）及对应 RLS 策略

### 3.4 配置 Auth 免邮件确认

Studio → Authentication → Settings → Email：

```
Enable email confirmations: 关闭
```

本地 `supabase start` 已默认开启 `GOTRUE_MAILER_AUTOCONFIRM=true`，注册即激活。

---

## 4. 启动开发服务器

### 4.1 纯前端调试（推荐开发阶段）

```bash
cd client-chat-tauri
npm run dev
```

Vite 默认在 `http://localhost:8084` 启动，在**浏览器**中调试即可。所有聊天功能（注册、登录、消息收发）在浏览器中完全可调试。

### 4.2 Tauri 桌面端启动

```bash
cd client-chat-tauri
npm run tauri dev
```

同时启动 Vite 前端和 Tauri Rust 后端，打开独立桌面窗口（自定义标题栏、系统托盘）。

> **提示**：Tauri 模式下，登录页点关闭 = 退出程序；聊天页点关闭 = 隐藏到系统托盘（右键托盘图标可退出）。

---

## 5. 功能测试清单

### 5.1 注册与登录

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 1 | 注册 | 输入邮箱/密码/工号/昵称 → 注册 | 跳转到聊天页面，侧边栏显示头像昵称 |
| 2 | 登出 | 点击侧边栏底部退出 | 跳回登录页 |
| 3 | 重新登录 | 输入刚注册的邮箱/密码 | 成功进入聊天页 |
| 4 | 会话恢复 | 关闭标签页 → 重新打开 `/chat` | 自动恢复登录态 |
| 5 | 路由守卫 | 未登录访问 `/chat` | 自动跳转 `/login` |
| 6 | 在线状态 | 登录后查看自己状态 | 侧边栏显示在线（绿点），`profiles.is_online = true` |

### 5.2 好友管理

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 7 | 搜索用户 | 点击"添加好友"按钮 → 输入工号/昵称 | 显示匹配的用户列表 |
| 8 | 添加好友 | 搜索结果中点击"添加" | 好友列表出现该好友 |
| 9 | 删除好友 | 右键好友 → 删除 | 好友从列表移除 |
| 10 | 列表展示 | 查看左侧好友列表 | 显示昵称、工号、头像、在线状态 |
| 11 | 选择好友 | 点击列表中好友 | 右侧聊天窗口激活 |

### 5.3 收发消息

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 12 | 发送消息 | 输入文字 → 回车 | 消息出现，输入框清空 |
| 13 | 气泡对齐 | 发多条消息 | 自己发的靠右（蓝绿），对方靠左（深灰） |
| 14 | 时间显示 | 查看气泡下方 | HH:mm 格式 |
| 15 | 自动滚底 | 发多条超过一屏 | 自动滚动到最新消息 |
| 16 | 实时接收 | 另一标签页以对方登录发消息 | 实时显示 |
| 17 | 消息持久化 | 刷新后重选该好友 | 历史消息正确加载 |

### 5.4 布局与 UI

| # | 测试项 | 预期结果 |
|---|--------|----------|
| 18 | 网格布局 | 图标栏 64px → 好友列表 280px → 聊天区自适应 |
| 19 | 自适应 | 调整窗口大小，布局填充整个视口 |
| 20 | 暗黑风格 | Discord 深色风格 + 蓝绿渐变点缀 |
| 21 | 系统托盘 | 聊天页关闭 → 缩至托盘；右键托盘 → 显示/退出 |
| 22 | 窗口标题栏 | 自定义标题栏包含最小化/最大化/关闭按钮 |

---

## 6. 常见问题

### 6.1 前端启动报错 `缺少环境变量`

**原因**：`.env.development` 不存在或缺少配置。  
**解决**：确认文件存在且含 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，**重启 Vite 服务器**。

### 6.2 注册失败：`Database error`

**原因**：数据库表未创建。  
**解决**：按顺序执行[第 3 节](#3-初始化数据库)的 4 个 SQL 脚本。

### 6.3 登录成功但 profiles 查询失败

**原因**：用户注册时 profiles 写入失败，但 auth.users 已创建。  
**解决**：在 Studio → Table Editor → profiles 中手动补记录（id 填 auth.users 中用户的 UUID）。

### 6.4 实时消息不更新

**原因**：`messages` 表未加入 Realtime 发布。  
**解决**：重新运行 [`01_init_database.sql`](./01_init_database.sql) 建表脚本（该脚本已含 `ALTER PUBLICATION` 语句，并处理了幂等执行）。

### 6.5 `supabase start` 容器启动失败

```bash
# 检查 Docker 是否运行
docker info

# 停止全部后重试
supabase stop
supabase start
```

### 6.6 Analytics 警告（可忽略）

```
WARNING: Analytics on Windows requires Docker daemon exposed on tcp://localhost:2375
```

不影响核心功能（聊天、Auth、Storage）。

### 6.7 端口冲突

| 端口 | 服务 | 修改位置 |
|------|------|---------|
| 54321 | Kong API | `supabase/config.toml` → `api.port` |
| 54322 | PostgreSQL | `supabase/config.toml` → `db.port` |
| 54323 | Studio | `supabase/config.toml` → `studio.port` |
| 8084 | Vite | `vite.config.ts` → `server.port` |

### 6.8 客户端始终显示"离线"

**原因**：`02_add_online_status.sql` 未执行（`profiles` 表缺少 `is_online` 字段和 `go_online()` / `go_offline()` RPC 函数）。  
**解决**：在 Studio SQL Editor 中执行 [`02_add_online_status.sql`](./02_add_online_status.sql)。

### 6.9 Tauri 编译报错 `failed to fill whole buffer` 或 `not RGBA`

**原因**：`src-tauri/icons/` 目录下图标文件无效或缺失。  
**解决**：运行 `node scripts/gen-icons.mjs` 重新生成图标。

### 6.10 Tauri 启动报 EBUSY 错误

**原因**：Vite 文件监视器与 Cargo 构建输出目录冲突。  
**解决**：已在 `vite.config.ts` 中配置 `server.watch.ignored: ['**/src-tauri/target/**']`，无需手动处理。

### 6.11 Tauri 客户端任意位置右键弹出浏览器菜单

**原因**：Tauri 内嵌的 WebView2 会在未阻止 `contextmenu` 事件的区域弹出浏览器原生右键菜单（刷新/另存为/打印/检查元素）。  
**解决**：已在 [`main.ts`](../client-chat-tauri/src/main.ts) 中添加全局阻止：

```ts
document.addEventListener('contextmenu', (e) => e.preventDefault())
```

各组件如需自定义右键菜单，在具体元素上使用 `@contextmenu.prevent="handler"` 即可（如消息气泡的右键菜单）。

### 6.12 头像显示裂图

**原因**：Supabase Storage 中对应图片文件丢失或 URL 过期（常见于 Docker 容器数据卷重建、bucket 被清理等情况），数据库中 `profiles.avatar_url` 仍指向旧地址。  
**解决**：重新上传头像，系统会生成新的有效 Storage URL 并更新数据库记录。

---

## 附录A：Tauri 客户端右键菜单问题

Tauri 使用 Windows 系统 WebView2 作为渲染引擎。WebView2 本身是一个嵌入式 Chromium 浏览器，默认在未处理 `contextmenu` 事件的区域会弹出浏览器原生右键菜单。

**已在 [`main.ts`](../client-chat-tauri/src/main.ts) 第 14 行全局禁用**，各组件通过 `@contextmenu.prevent` 自主决定是否弹出定制菜单。

---

# 第二部分：二期 Go 后端环境

## 7. Go 后端开发环境

### 7.1 安装 Go

从 [Go 官网](https://go.dev/dl/) 下载 Windows `.msi` 安装包，按默认配置一路下一步即可。

```bash
go version   # 验证安装
```

### 7.2 准备 MySQL 数据库

在本地或目标服务器的 MySQL 中创建一个**空数据库**（字符集选 `utf8mb4`）：

```sql
CREATE DATABASE chat_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> **注意**：数据库名需与 [`config/config.yaml`](../go-chat-server/config/config.yaml) 中的 `database.dbname` 一致（默认 `chat_db`）。

### 7.3 修改配置文件

编辑 [`go-chat-server/config/config.yaml`](../go-chat-server/config/config.yaml)，将 MySQL 连接信息修改为实际环境：

```yaml
database:
  host: 127.0.0.1
  port: 3306
  user: root
  password: "your_password"
  dbname: chat_db
```

Redis 为可选项，如不需要可关闭：

```yaml
redis:
  enable: false
```

### 7.4 本地开发启动

在项目根目录 `go-chat-server/` 下打开终端：

```bash
# 1. 拉取依赖（首次运行）
go mod tidy

# 2. 一键启动
go run main.go
```

终端会打印启动日志，GORM 会**自动创建所有表结构**。看到以下输出即表示启动成功：

```
MySQL 连接成功，AutoMigrate 完成
🚀 go-chat-server 启动成功，监听地址: :8194
   API 基路径: http://127.0.0.1:8194/api
   WebSocket:  ws://127.0.0.1:8194/ws
```

> **提示**：不要关闭终端窗口，后端会一直运行。按 `Ctrl + C` 停止。

### 7.5 编译为独立可执行文件

```bash
# Windows 编译
go build -ldflags "-s -w" -o go-chat-server.exe main.go

# 编译完成后生成 go-chat-server.exe（约 15~20MB）
```

生成的文件是**纯绿色的、无任何运行时依赖**的独立可执行文件。将其与 `config/config.yaml` 放在同一目录下即可运行。

---

## 8. Go 后端 Windows 部署（WinSW 方案）

在 Windows 服务器上长期运行时，需要将 Go 后端注册为 **Windows 系统服务**，实现：
- 后台静默运行（无黑窗口）
- 开机自启
- 崩溃自动重启
- 在 `services.msc` 中可视化管理

> **重要**：Windows 自带的 `sc create` 命令要求程序必须响应系统服务握手信号，普通 Go 控制台程序无法满足，会报"错误 1053：服务没有及时响应"。因此必须使用 **WinSW** 这个开源工具做桥接。

### 8.1 准备部署文件

将以下文件放在目标服务器的同一个目录下（例如 `D:\chat-server\`）：

| 文件 | 说明 |
|------|------|
| `go-chat-server.exe` | Go 后端编译产物 |
| `config/config.yaml` | 配置文件（需修改为服务器实际 MySQL 地址） |
| `WinSW-x64.exe` | WinSW 服务管理工具 |

### 8.2 改名并编写 WinSW 配置

将 `WinSW-x64.exe` 重命名为 `ChatServer.exe`，然后在同一目录下创建 `ChatServer.xml`：

```xml
<service>
  <id>ChatServer</id>
  <name>Go Chat Server Backend</name>
  <description>Tauri 聊天软件的 Go 原生后端常驻服务</description>
  <executable>D:\chat-server\go-chat-server.exe</executable>
  <workingdirectory>D:\chat-server</workingdirectory>
  <logmode>rotate</logmode>
  <startmode>Automatic</startmode>
</service>
```

> **注意**：`<executable>` 和 `<workingdirectory>` 必须填写**绝对路径**，请根据实际部署目录修改。

### 8.3 注册并启动服务

在 `D:\chat-server\` 目录下，以**管理员身份**打开 PowerShell，依次执行：

```powershell
# 1. 注册成为 Windows 服务
.\ChatServer.exe install

# 2. 启动服务
.\ChatServer.exe start
```

此时打开 Windows 服务管理器（`Win + R` → 输入 `services.msc` → 回车），即可看到名为 **"Go Chat Server Backend"** 的服务，状态为"正在运行"。

### 8.4 后续管理命令

```powershell
# 停止服务
.\ChatServer.exe stop

# 卸载服务
.\ChatServer.exe uninstall

# 重启服务
.\ChatServer.exe restart

# 查看服务状态
.\ChatServer.exe status
```

### 8.5 卸载旧服务（如曾用 sc create 安装）

如果之前用 `sc create` 创建过同名服务导致冲突，先卸载：

```powershell
sc delete ChatServer
```

---

## 9. Go 后端 Linux 部署（systemd 方案）

在 Linux 上，Go 是天然主场。通过**交叉编译**在 Windows 开发机上直接打出 Linux 二进制包，然后用 **systemd** 托管为系统服务。

### 9.1 Windows 上交叉编译 Linux 包

在项目根目录 `go-chat-server/` 下打开 PowerShell：

```powershell
# 1. 锁死目标系统为 Linux（64 位）
$env:GOOS = "linux"
$env:GOARCH = "amd64"

# 2. 编译（剔除调试信息、压缩体积）
go build -ldflags "-s -w" -o go-chat-server main.go

# 3. 恢复 Windows 开发环境
$env:GOOS = "windows"
```

编译完成后，项目根目录下会生成 `go-chat-server` 文件（**无 `.exe` 后缀，这是 Linux 二进制文件**）。

### 9.2 上传文件到 Linux 服务器

通过 SFTP 工具（FileZilla、Mobaxterm 等）将以下两个文件上传到 Linux 服务器的 `/app/chat-server/` 目录：

| 文件 | 说明 |
|------|------|
| `go-chat-server` | Linux 二进制包 |
| `config/config.yaml` | 配置文件（需修改为 Linux 服务器实际 MySQL 地址） |

### 9.3 服务器端环境准备

```bash
cd /app/chat-server/

# 1. 赋予执行权限（关键！）
chmod +x go-chat-server

# 2. 准备空 MySQL 数据库（如未创建）
# mysql -u root -p -e "CREATE DATABASE chat_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3. 修改 config.yaml（MySQL 账号/密码/IP、Redis 开关等）
vim config/config.yaml

# 4. 如果不需要 Redis，关闭 Redis
#    redis.enable: false
```

### 9.4 创建 systemd 服务配置

```bash
sudo vim /etc/systemd/system/chat-server.service
```

粘贴以下内容：

```ini
[Unit]
Description=Tauri Go Chat Server Backend
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/app/chat-server
ExecStart=/app/chat-server/go-chat-server
Restart=always
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=chat-server

[Install]
WantedBy=multi-user.target
```

保存并退出（`:wq`）。

### 9.5 启动服务并设置开机自启

```bash
# 1. 刷新 systemd 服务列表
sudo systemctl daemon-reload

# 2. 开启开机自启
sudo systemctl enable chat-server

# 3. 启动服务
sudo systemctl start chat-server

# 4. 查看运行状态
sudo systemctl status chat-server
```

看到 `active (running)` 即表示服务已成功运行。

### 9.6 查看日志

```bash
# 实时查看控制台日志
journalctl -u chat-server.service -f -n 50
```

正常启动日志示例：

```
MySQL 连接成功，AutoMigrate 完成
🚀 go-chat-server 启动成功，监听地址: :8194
   API 基路径: http://127.0.0.1:8194/api
   WebSocket:  ws://127.0.0.1:8194/ws
```

### 9.7 常用 systemd 命令

```bash
# 启动
sudo systemctl start chat-server

# 停止
sudo systemctl stop chat-server

# 重启
sudo systemctl restart chat-server

# 禁用开机自启
sudo systemctl disable chat-server

# 卸载服务（需先 stop）
sudo rm /etc/systemd/system/chat-server.service
sudo systemctl daemon-reload
```

---

## 10. 前端切换到 Go 后端

从一期 Supabase 切换到二期 Go 后端，只需修改一个环境变量。

### 10.1 开发环境切换

编辑 `client-chat-tauri/.env.development`：

```env
# 之前（一期）
VITE_BACKEND_TYPE=SUPABASE

# 切换后（二期）
VITE_BACKEND_TYPE=GO
VITE_GO_BASE_URL=http://127.0.0.1:8194
VITE_GO_WS_URL=ws://127.0.0.1:8194/ws
```

修改后**必须重启 Vite 开发服务器**，否则环境变量不生效。

### 10.2 生产环境切换

编辑 `client-chat-tauri/.env.production`：

```env
VITE_BACKEND_TYPE=GO
VITE_GO_BASE_URL=https://realapex.site:8094
VITE_GO_WS_URL=wss://realapex.site:8094/ws
```

然后重新打包：

```bash
npm run tauri build
```

### 10.3 切换原理

前端 Service 层采用适配器模式，根据 `VITE_BACKEND_TYPE` 在**编译时**静态选择后端实现：

| 环境变量值 | 后端实现 | 数据流 |
|-----------|---------|--------|
| `SUPABASE` | `SupabaseChatService` | 前端 → Supabase SDK → PostgreSQL |
| `GO` | `GoChatService` | 前端 → Axios/WebSocket → Go 后端 → MySQL |

- 当 `VITE_BACKEND_TYPE=SUPABASE` 时，`GoChatService` 实例不会被构造，浏览器端不会启动任何 WebSocket 连接。
- 当 `VITE_BACKEND_TYPE=GO` 时，使用 Axios HTTP 请求 API + 原生 WebSocket 长连接进行实时通信。

### 10.4 构建消息确认

切换后重新编译，检查输出包中是否包含 `superbase-js` / `gorilla/websocket` 等不需要的依赖，确保包体积精简。

---

> **总结**：一期使用 Supabase 本地 Docker 快速开发，二期通过一个环境变量即可切换到自建 Go 后端，UI 层和 Store 层完全无需改动。
