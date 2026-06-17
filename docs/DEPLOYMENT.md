# App-Chat 部署手册

> **适用版本**：1.0.0
> **最后更新**：2026-06-16
> **技术栈**：Tauri + Vue 3 + Go (Gin + GORM + Melody)

---

## 1. 端口宪法 — 全场景统一锁死

| 端口 | 归属 | 说明 |
|------|------|------|
| **8094** | Go 后端真身 | 本地 & 生产统一，生产环境仅绑 `127.0.0.1`，由 Nginx 反代 |
| **8084** | Nginx 公网大门 | HTTPS/WSS SSL 终结，反向代理到 `127.0.0.1:8094` |
| **5174** | Vite 前端开发服务器 | 仅本地开发使用 |

> **铁律**：对外只需开放 8084。Go 后端的 8094 躲在 Nginx 背后，安全组不暴露。

---

## 2. 三种部署模式概览

| 模式 | 场景 | 核心入口 | 中间件策略 |
|------|------|---------|-----------|
| **A：本地快速验证** | Windows 拖动 exe 直跑 | [`deploy/run-backend-dev.bat`](../deploy/run-backend-dev.bat) + [`deploy/run-client-dev.bat`](../deploy/run-client-dev.bat) | 借本地已装 MySQL + Redis |
| **B：腾讯云公网部署** | 生产正规军，全自动流水线 | [`deploy/deploy-server-tencent.ps1`](../deploy/deploy-server-tencent.ps1) | 云上 MySQL + Docker Redis |
| **C：独立内网私有部署** | 内网 Windows 服务器 | `build-server-lan.bat` 一键构建 → WinSW 注册服务 | 内网现成 MySQL，Redis 关闭 |

---

## 3. 模式 A：本地快速验证

### 3.1 前置条件

- Windows 开发机，已安装 Go SDK（`go version`）
- 本地已安装 Node.js 18+
- 本地 MySQL 运行中，创建空白库：

```sql
CREATE DATABASE IF NOT EXISTS chat_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

- 本地 Redis 运行中（可选；若关闭，修改 [`config.yaml`](../go-chat-server/config/config.yaml:17) 中 `redis.enable: false`）

### 3.2 启动后端（双击）

1. 双击 [`deploy/run-backend-dev.bat`](../deploy/run-backend-dev.bat)
2. 脚本自动：
   - 在 [`go-chat-server/`](../go-chat-server/) 下 `go build` 编译 `server.exe`
   - 前台启动，死守 **8094** 端口
   - GORM `AutoMigrate` 自动对齐 MySQL 表结构（首次启动建表）
3. 看到如下日志即成功：

```
MySQL 连接成功，AutoMigrate 完成
🚀 go-chat-server 启动成功，监听地址: :8094
    API 基路径: http://127.0.0.1:8094/api
    WebSocket:  ws://127.0.0.1:8094/ws
```

> 终端保持打开，`Ctrl + C` 停止。

### 3.3 启动前端（双击）

1. 双击 [`deploy/run-client-dev.bat`](../deploy/run-client-dev.bat)
2. 脚本自动：
   - 检查 `node_modules`，首次自动 `npm install`
   - 设置环境变量 `VITE_GO_BASE_URL=http://127.0.0.1:8094`
   - 启动 Vite 开发服务器，浏览器打开 `http://localhost:5174`
3. Vite 内置 proxy 将 `/api` 转发到 `127.0.0.1:8094`

### 3.4 验证

```bash
# Go 后端存活
curl http://127.0.0.1:8094/api/ping

# 前端页面
curl -I http://localhost:5174
```

### 3.5 本地架构拓扑

```
浏览器 http://localhost:5174 (Vite)
       │
       ├─ /api → proxy → http://127.0.0.1:8094 (Go 直连)
       │
       └─ ws://127.0.0.1:8094/ws (WebSocket 直连)
```

---

## 4. 模式 B：腾讯云公网部署

### 4.1 前置条件

| 项目 | 要求 |
|------|------|
| 腾讯云 CVM | 已开通，安全组**只开放 8084 端口** |
| 云上 MySQL | 已安装，创建 `chat_db` 库 |
| 云上 Redis | 已安装（可选，通过 systemd `Environment="REDIS_ENABLE=false"` 关闭） |
| 云上 Nginx | 已安装，若未安装脚本自动 `apt install` |
| 本地开发机 | Windows，`ssh` + `scp` 可用（免密登录），Go SDK |

### 4.2 配置文件准备

部署前按实际环境修改：

**A.** [`go-chat-server/config/config.yaml`](../go-chat-server/config/config.yaml) — 唯一配置文件，已内置 `${ENV:default}` 语法；生产环境变量由 systemd 的 [`chat-server.service`](../deploy/chat-server.service) 中 `Environment=` 注入

生产环境无需修改 config.yaml — 当前 YAML 中所有值均为 `${ENV:default}` 格式，环境差异通过 systemd 注入。部署前只需确认 [`deploy/chat-server.service`](../deploy/chat-server.service) 中 `Environment=` 的值与实际环境匹配（数据库地址、密码、域名等）。

**B.** [`deploy/deploy-server-tencent.ps1`](../deploy/deploy-server-tencent.ps1) 第 9-10 行 — 填入实际 IP 和域名：

```powershell
$SERVER_IP = "129.211.9.238"
$DOMAIN    = "realapex.site"
```

### 4.3 一键部署

右键 → **使用 PowerShell 运行** [`deploy/deploy-server-tencent.ps1`](../deploy/deploy-server-tencent.ps1)

全自动 6 步流水线：

| 步骤 | 操作 | 位置 |
|------|------|------|
| [1/6] | 本地交叉编译 Linux 二进制 (`go build -ldflags "-s -w"`) | Windows → 本地 |
| [2/6] | SCP 上传：二进制 + 配置 + systemd 服务 + Nginx 配置 | 本地 → 腾讯云 |
| [3/6] | SSH 远程：`chmod` 赋权 → `systemctl daemon-reload` → 重启 `chat-server` → 重载 Nginx | 腾讯云内 |
| [4/6] | SSH + curl 内检 Go `127.0.0.1:8094` + 外检 HTTPS `8084` | 双链路探测 |
| [5/6] | 清理本地编译产物 | 本地 |
| [6/6] | 打印外部访问地址 | — |

### 4.4 生产架构拓扑

```
外部客户端
       │
  ┌────▼──────────────────────────────────────┐
  │  腾讯云 CVM                                │
  │                                           │
  │  Nginx (宿主机)                            │
  │  listen 8084 ssl                          │
  │  ├─ /api → proxy http://127.0.0.1:8094    │
  │  ├─ /ws  → proxy http://127.0.0.1:8094    │
  │  └─ /uploads/ → proxy 静态资源             │
  │       │                                   │
  │  go-chat-server (systemd 守护)             │
  │  listen 127.0.0.1:8094                    │
  │  WorkingDirectory /root/chat-server        │
  │  ├─ config/config.yaml                    │
  │  └─ uploads/ (文件存储)                    │
  │       │                                   │
  │  MySQL (宿主机/Docker) :3306               │
  │  Redis (可选) :6379                        │
  └───────────────────────────────────────────┘

对外地址:
  API:        https://你的域名:8084/api
  WebSocket:  wss://你的域名:8084/ws
  文件:       https://你的域名:8084/uploads/
```

### 4.5 更新部署

代码更新后，重新执行 `deploy-server-tencent.ps1` 即可。脚本会自动：
- 重新交叉编译
- SCP 覆盖二进制
- `systemctl restart` 重启服务
- Nginx 配置不变时可注释掉对应的 scp 行

### 4.6 systemd 常用命令

```bash
# 查看服务状态
systemctl status chat-server

# 查看实时日志
journalctl -u chat-server -f

# 手动重启
systemctl restart chat-server

# 停止
systemctl stop chat-server
```

---

## 5. 模式 C：独立内网私有部署

> **场景**：企业内网机房，有现成 MySQL 但无 Redis、无 root 权限、网络受限。

### 5.1 前置准备

- 内网已有一台 Windows 服务器（管理员权限，用于注册 WinSW 服务）
- 内网 MySQL 已创建 `chat_db` 库
- **Redis 关闭**：编辑 [`build-server-lan.bat`](../deploy/build-server-lan.bat:11) 头部参数，设 `set "REDIS_ENABLE=false"`，构建时自动展开到 config.yaml；系统自动降级为纯 MySQL 模式（在线状态走内存 map，未读走 MySQL 实时查询）
- 若内网有 Nginx 且你有权限修改其配置，可复用 Nginx 反代（监听 8084）；若无，客户端直连 Go 的 8094

### 5.2 构建 & 部署步骤

> **核心理念**：所有内网参数集中管理在 [`deploy/build-server-lan.bat`](../deploy/build-server-lan.bat) 头部 `set` 变量中，构建时自动展开到 config.yaml。改内网部署参数，只改这一个 bat。

**步骤 1** — 编辑构建参数：

打开 [`deploy/build-server-lan.bat`](../deploy/build-server-lan.bat)，修改头部参数为你的内网环境：

```bat
:: ========== 📌 内网部署参数（改内网只改这里） ==========
set "CHAT_SERVER_MODE=release"
set "DB_HOST=22.188.9.144"          ← 改为你的内网 MySQL IP
set "DB_PORT=3306"
set "DB_USER=root"
set "DB_PASSWORD=Star002!"          ← 改为你的数据库密码
set "DB_NAME=chat_db"
set "REDIS_ENABLE=false"            ← 内网无 Redis 则 false
set "JWT_SECRET=go-chat-server-prod-jwt-secret-change-me"
set "UPLOAD_DIR=D:/data/chat-server/uploads"
:: ========================================================
```

**步骤 2** — 双击运行 [`deploy/build-server-lan.bat`](../deploy/build-server-lan.bat)：

- 自动编译 Vue 前端（LAN 模式）
- 自动编译 Go 后端（内嵌前端，Windows amd64）
- **构建时展开 config.yaml**：调用 `go-chat-server.exe --expand-config` 将 `${VAR:default}` 模板替换为步骤 1 设置的实际值，输出写死参数的无变量配置文件
- 产物汇总到 `bin/内网版本/chat-server/` 目录

**步骤 3** — 将 `bin/内网版本/chat-server/` 整个目录复制到内网 Windows 服务器（如 `D:\chat-server\`）。

**步骤 4** — 以管理员身份运行 `D:\chat-server\startServer.bat`，注册并启动 WinSW 服务（开机自启）。

**步骤 5 (可选)** — 配置内网 Nginx 反代。

联系管理员在内网 Nginx 中新增配置块（参照 [`deploy/nginx-chat.conf`](../deploy/nginx-chat.conf)），监听内网 `8084`：

- `/api` → `proxy_pass http://127.0.0.1:8094`
- `/ws` → `proxy_pass` 带 `Upgrade` 头
- `/uploads/` → 静态资源代理

若无 Nginx 权限，客户端直接配置 `VITE_GO_BASE_URL=http://<内网IP>:8094` 直连。

### 5.3 内网 Redis 降级说明

`redis.enable: false` 时，系统自动走以下降级路径：

| 功能 | 有 Redis | 无 Redis (降级) |
|------|---------|----------------|
| 在线状态 | `SET online:{uid}` | Go 内存 map `mgr.clients` |
| 未读计数 | `INCR unread:{uid}` | MySQL `SELECT COUNT(*) WHERE is_read=false` |
| 离线消息缓冲 | `LPUSH offline_msg:{uid}` | 直接写 MySQL，上线后从 `WHERE is_read=false` 拉取 |

> 代码中有 `if global.RDB != nil` 守卫，关闭 Redis 不会 panic。

---

## 6. 数据库与表结构

GORM `AutoMigrate` 在 Go 后端启动时自动建表/更新字段，无需手动执行 DDL。

### 6.1 核心表

| 表 | 说明 | 对应 model |
|----|------|-----------|
| `users` | 用户账号（注册登录） | [`model/user.go`](../go-chat-server/model/user.go) |
| `profiles` | 用户公开资料（昵称、工号、头像） | [`model/user.go`](../go-chat-server/model/user.go) |
| `friendships` | 好友关系（双向存储） | [`model/friendship.go`](../go-chat-server/model/friendship.go) |
| `messages` | 聊天消息（含实时推送） | [`model/message.go`](../go-chat-server/model/message.go) |

### 6.2 主键规范

- 所有实体表主键为 **UUID** (string 类型，Go 侧 `gen_random_uuid()`)
- 7 位工号 (`employee_id`) 仅作为展示属性，**不作为**物理主键

### 6.3 建库 SQL

```sql
CREATE DATABASE IF NOT EXISTS chat_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Go 后端首次启动即自动建表，无需手动 CREATE TABLE
```

---

## 7. 客户端配置

### 7.1 环境变量 (`.env`)

**本地开发** ([`.env.development`](../client-chat-tauri/.env.development))：

```env
VITE_BACKEND_TYPE=GO
VITE_GO_BASE_URL=http://127.0.0.1:8094
VITE_GO_WS_URL=ws://127.0.0.1:8094/ws
```

**生产打包** ([`.env.production`](../client-chat-tauri/.env.production))：

```env
VITE_BACKEND_TYPE=GO
VITE_GO_BASE_URL=https://realapex.site:8084
VITE_GO_WS_URL=wss://realapex.site:8084/ws
```

> `VITE_BACKEND_TYPE` 取值：`SUPABASE`（一期 Supabase 后端）或 `GO`（二期自建 Go 后端）。

### 7.2 打包客户端

```bash
cd client-chat-tauri
npm run tauri build
```

产物在 `client-chat-tauri/src-tauri/target/release/bundle/`：
- `.msi` 安装包
- `.exe` 绿色版

---

## 8. 常见问题

### 8.1 Go 后端启动后立即退出

```bash
# 查看 systemd 日志
journalctl -u chat-server --no-pager -n 50

# 常见原因：
# 1. config.yaml 中 MySQL 密码/地址错误
# 2. MySQL 未创建 chat_db 库
# 3. 端口 8094 被占用 → lsof -i :8094
# 4. Redis 连接失败且 enable=true → 临时改为 false 或启动 Redis
```

### 8.2 Nginx 502 Bad Gateway

```bash
# 确认 Go 进程存活
systemctl status chat-server
curl http://127.0.0.1:8094/api/ping

# 确认 Nginx 配置中 proxy_pass 端口正确（8094，非 8084）
grep proxy_pass /etc/nginx/conf.d/app-chat.conf
```

### 8.3 WebSocket 一直断开

1. 确认 Nginx 中 `/ws` location 配置了 `proxy_http_version 1.1` 和 `Upgrade` 头
2. 查看 [`deploy/nginx-chat.conf`](../deploy/nginx-chat.conf) 中 `/ws` 块
3. 确认客户端 `VITE_GO_WS_URL` 使用 `wss://` (HTTPS) 而非 `ws://`

### 8.4 端口冲突

```bash
# Linux
lsof -i :8084 -i :8094

# Windows
netstat -ano | findstr "8084 8094 5174"
```

### 8.5 腾讯云安全组放行

确保安全组入站规则中包含：

| 端口 | 协议 | 来源 | 说明 |
|------|------|------|------|
| 8084 | TCP | 0.0.0.0/0 | Nginx HTTPS/WSS 入口 |

> **不需要**开放 8094（Go 只绑 127.0.0.1）。

---

## 9. 目录结构速查

```
app-chat/
├── deploy/
│   ├── run-backend-dev.bat        # 模式 A：本地后端一键启动
│   ├── run-client-dev.bat         # 模式 A：本地前端一键启动 (tauri:dev)
│   ├── build-client-lan.bat       # 模式 B：打包内网 Tauri 桌面客户端 (.exe/.msi)
│   ├── build-client-tencent.bat   # 模式 B：打包腾讯云 Tauri 桌面客户端 (.exe/.msi)
│   ├── build-server-lan.bat       # 模式 C：构建内网 Server all-in-one (Go + Vue)
│   ├── deploy-server-tencent.ps1  # 模式 B：腾讯云 Go 后端全自动部署
│   ├── nginx-chat.conf            # 模式 B/C：Nginx HTTPS 反代配置
│   └── chat-server.service        # 模式 B：Linux systemd 服务定义
├── go-chat-server/
│   ├── main.go                    # Go 入口
│   ├── config/
│   │   ├── config.yaml            # 唯一配置文件（${ENV:default} 语法，本地 dev 走默认值）
│   │   └── config.go              # 配置加载 + 环境变量展开器
│   ├── model/                     # GORM 数据模型 (AutoMigrate)
│   ├── service/                   # 业务逻辑层
│   ├── api/                       # HTTP 控制器
│   ├── im/                        # WebSocket 长连接管理
│   ├── middleware/                # JWT 中间件
│   ├── initialize/                # DB/Redis/Router 初始化
│   └── global/                    # 全局单例
├── client-chat-tauri/
│   ├── .env.development           # 本地环境变量
│   ├── .env.production            # 生产环境变量
│   ├── vite.config.ts             # Vite 配置 (端口 5174 + proxy)
│   ├── src/
│   │   ├── services/              # 网络层适配器
│   │   ├── stores/                # Pinia 状态管理
│   │   ├── views/chat/            # 聊天主界面
│   │   └── utils/                 # 工具函数
│   └── src-tauri/                 # Tauri 桌面壳 (Rust)
└── docs/
    ├── DEPLOYMENT.md              # 本文档
    ├── app-chat环境搭建与启动指南.md
    ├── app-chat前端API调用参考.md
    └── app-chat后端Go接口对齐图纸.md
```

---

> 📌 **关键提醒**
>
> 1. **端口铁律**：对外 8084 (Nginx)，对内 8094 (Go)，开发 5174 (Vite)
> 2. **GORM AutoMigrate** 是唯一的建表机制，禁止手动执行 DDL
> 3. **Redis 可关**：`redis.enable: false` 后自动降级，不崩不 panic
> 4. **JWT 密钥**：生产部署前务必修改 [`chat-server.service`](../deploy/chat-server.service) 中 `Environment="JWT_SECRET=..."` 的值
> 5. **SSL 证书**：模式 B 需要云上 Nginx 配置 SSL 证书，路径见 [`nginx-chat.conf`](../deploy/nginx-chat.conf)
> 6. **文件存储**：生产环境 `upload.dir` 设为绝对路径，与 Nginx `/uploads/` 代理对齐
