# 信创客户端构建方案 (build-client-arm / build-client-x86)

> 版本：v1.0  
> 日期：2026-06-29  
> 状态：📋 计划阶段（尚未编码）  
> 目标：在 Windows 开发机上，通过 WSL2 + Docker + QEMU，交叉编译出信创 Linux 桌面客户端  

---

## 1. 背景与目标

### 1.1 业务背景

当前项目 `app-chat` 的客户端基于 **Tauri 2.x** 构建，现有 [`build-client-lan.bat`](../deploy/build-client-lan.bat) 和 [`build-client-tencent.bat`](../deploy/build-client-tencent.bat) 均面向 **Windows** 平台（MSVC 工具链，产物为 `.exe` / `.msi`）。

信创终端用户运行的是国产 Linux 操作系统（麒麟 V10、统信 UOS 等），需要交付 **Linux 原生客户端**（`.deb` / `.AppImage`），且需同时覆盖两种 CPU 架构。

### 1.2 目标平台

| 平台 | CPU 架构 | 代表芯片 | Tauri Rust Target | 产物格式 |
|------|----------|----------|-------------------|----------|
| 海光 / 兆芯 | **x86_64** (amd64) | Hygon Dhyana / Zhaoxin KX-6000 | `x86_64-unknown-linux-gnu` | `.deb` + `.AppImage` |
| 飞腾 / 鲲鹏 | **aarch64** (arm64) | Phytium FT-2000 / Kunpeng 920 | `aarch64-unknown-linux-gnu` | `.deb` + `.AppImage` |

### 1.3 网络配置策略

信创客户端面向 **内网部署**，直接复用现有 [`.env.LAN`](../client-chat-tauri/.env.LAN) 的网络配置：

- `VITE_GO_BASE_URL=http://22.188.9.15:8084`（内网摆渡 Nginx）
- `VITE_GO_WS_URL=ws://22.188.9.15:8084/ws`

信创客户端本质上就是 **内网 Linux 版客户端**，不需要新建独立的 `.env` 文件。

### 1.4 脚本命名

| 脚本 | 目标架构 | 说明 |
|------|----------|------|
| [`build-client-x86.bat`](../deploy/build-client-x86.bat) | x86_64 (海光/兆芯) | Windows 批处理，调用 WSL2 Docker 编译 |
| [`build-client-arm.bat`](../deploy/build-client-arm.bat) | aarch64 (飞腾/鲲鹏) | Windows 批处理，调用 WSL2 Docker + QEMU 模拟编译 |

---

## 2. 构建架构设计

### 2.1 总体思路

**不在 Windows 本机安装 Linux 交叉编译工具链**（配置复杂、容易因库版本不匹配失败）。改用 **WSL2 内 Docker 容器编译**：

```
┌──────────────────────────────────────────────────┐
│  Windows 开发机                                     │
│  ┌──────────────┐    ┌─────────────────────────┐  │
│  │ build-client- │    │  WSL2 (Ubuntu)           │  │
│  │ x86.bat       │───▶│  ┌─────────────────────┐│  │
│  │ build-client- │    │  │ Docker               ││  │
│  │ arm.bat       │    │  │  ┌─────────────────┐ ││  │
│  └──────────────┘    │  │  │ node:20-bookworm │ ││  │
│                      │  │  │ + Tauri deps     │ ││  │
│                      │  │  │ + Rust           │ ││  │
│                      │  │  │ 编译 client-chat │ ││  │
│                      │  │  └─────────────────┘ ││  │
│                      │  └─────────────────────┘│  │
│                      └─────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 2.2 两条路径对比

| 维度 | x86_64 构建 | ARM64 构建 |
|------|------------|------------|
| Docker 启动参数 | 无额外 `--platform`（默认 native） | `--platform linux/arm64` |
| QEMU 依赖 | **不需要**（WSL2 本身就是 x86_64） | **必须**（QEMU 模拟 ARM 指令集） |
| 编译速度 | 正常（约 5-15 分钟首次） | **慢 3~8 倍**（软件模拟，约 20-60 分钟） |
| 前置准备 | 仅需 Docker | Docker + QEMU（见 4.1 节） |

### 2.3 Docker 镜像选型

选用 **`node:20-bookworm`**（Debian 12），理由：

- Debian 12 的 APT 仓库已包含 **`libwebkit2gtk-4.1-dev`**（Tauri 2.x 必需，注意是 **4.1** 不是 4.0）
- Node.js 20 LTS 与项目 `package.json` 的 `@types/node` 版本匹配
- 该镜像同时有 `linux/amd64` 和 `linux/arm64` 多架构标签

> ⚠️ **关键纠正**：用户参照材料中的命令使用了 `libwebkit2gtk-4.0-dev`，这是 **Tauri 1.x** 的依赖。本项目的 Tauri 2.x 必须使用 **`libwebkit2gtk-4.1-dev`**。

---

## 3. 前置准备

### 3.1 WSL2 + Docker（必须）

在 Windows 上安装 WSL2 和 Docker Desktop（或 WSL2 内原生 Docker），确认可用：

```bash
# 在 WSL2 终端中验证
docker version
docker run --rm hello-world
```

### 3.2 QEMU 多架构支持（仅 ARM64 构建需要）

```bash
# 在 WSL2 终端中执行（一次性安装）
sudo apt-get update && sudo apt-get install -y qemu-user-static
sudo docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
```

验证 QEMU 就绪：

```bash
docker run --rm --platform linux/arm64 node:20-bookworm uname -m
# 应输出：aarch64
```

### 3.3 项目文件准备

构建前确保：

| 文件 | 说明 |
|------|------|
| [`client-chat-tauri/.env.LAN`](../client-chat-tauri/.env.LAN) | 已填写内网服务器 IP |
| [`client-chat-tauri/src-tauri/tauri.conf.json`](../client-chat-tauri/src-tauri/tauri.conf.json) | 已添加 Linux bundle 配置（见第 4 节） |
| `client-chat-tauri/node_modules/` | Docker 容器内会执行 `npm install`，本机不需要 |

---

## 4. Tauri 配置适配（`tauri.conf.json`）

### 4.1 现状

当前 [`tauri.conf.json`](../client-chat-tauri/src-tauri/tauri.conf.json) 的 `bundle` 配置仅包含通用配置，未显式配置 Linux 打包格式：

```json
"bundle": {
    "active": true,
    "targets": "all",
    "icon": [...]
}
```

### 4.2 需新增的 Linux 打包配置

```json
"bundle": {
    "active": true,
    "targets": "all",
    "icon": [...],
    "linux": {
        "deb": {
            "depends": [
                "libwebkit2gtk-4.1-0",
                "libgtk-3-0",
                "libayatana-appindicator3-1",
                "libsoup-3.0-0",
                "libjavascriptcoregtk-4.1-0"
            ]
        }
    }
}
```

> **说明**：`"targets": "all"` 在 Linux 上默认生成 `.deb` + `.AppImage` + `.rpm`。信创系统主要使用 `.deb`（麒麟/统信均为 Debian 系），`.AppImage` 作为免安装绿色版兼容备用。

### 4.3 Rust 依赖补充

Tauri 2.x Linux 构建需要 `libsoup-3.0`（非 2.4），Dockerfile 中的 `apt-get install` 需包含：

```
libsoup-3.0-dev
libwebkit2gtk-4.1-dev
libjavascriptcoregtk-4.1-dev
```

---

## 5. `build-client-x86.bat` 脚本设计

### 5.1 职责

- 在 WSL2 Docker 中以 **原生 x86_64 模式** 编译 Tauri Linux 客户端
- 产物：`.deb` + `.AppImage`（x86_64）
- 输出到 [`bin/chat-client-xc-x86/`](../bin/chat-client-xc-x86/)

### 5.2 脚本流程

```
┌──────────────────────────────────────────────────┐
│ Step 1: 环境检查                                    │
│   - 检测 WSL2 是否可用 (wsl --list)                  │
│   - 检测 Docker 是否可用 (wsl docker version)        │
│   - 校验 .env.LAN 存在                               │
├──────────────────────────────────────────────────┤
│ Step 2: 预览配置                                    │
│   - 打印 .env.LAN 内容                              │
│   - 提取目标服务器 IP 供确认                         │
├──────────────────────────────────────────────────┤
│ Step 3: Docker 编译                                 │
│   - 通过 wsl 执行 docker run                         │
│   - 挂载项目根目录到容器 /app                        │
│   - 容器内: apt → rustup → npm install → tauri build │
├──────────────────────────────────────────────────┤
│ Step 4: 汇总产物                                    │
│   - 从 src-tauri/target/release/bundle/             │
│   - 复制 .deb / .AppImage 到 bin/chat-client-xc-x86/ │
├──────────────────────────────────────────────────┤
│ Step 5: 结果展示                                    │
│   - 列出产物文件及大小                               │
│   - 显示分发说明                                    │
└──────────────────────────────────────────────────┘
```

### 5.3 核心 Docker 命令

```bash
# WSL2 内执行
docker run --rm \
  -v "$(wslpath -a 'D:\ProjectDir\app-chat'):/app" \
  -w /app/client-chat-tauri \
  node:20-bookworm \
  /bin/bash -c "
    apt-get update &&
    apt-get install -y \
      libsoup-3.0-dev \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      build-essential \
      curl \
      wget &&
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y &&
    source \$HOME/.cargo/env &&
    rustup target add x86_64-unknown-linux-gnu &&
    npm install &&
    npm run tauri build -- --target x86_64-unknown-linux-gnu
  "
```

### 5.4 环境变量注入

`.env.LAN` 的值通过两种方式进入容器：

1. **挂载文件**：`-v` 将整个项目目录挂入容器，`.env.LAN` 文件自然可见
2. **构建时指定 mode**：`npm run tauri build` 前 `cp .env.LAN .env.production`（临时覆盖），或通过 Vite 的 `--mode lan` 指定模式

> **推荐方案**：在容器内构建前执行 `cp .env.LAN .env`（临时覆盖基线），因为 Tauri `beforeBuildCommand` 是 `npm run build`，Vite 默认加载 `.env.production`。最简单的方式是脚本内将 `.env.LAN` 复制为 `.env.production`。

---

## 6. `build-client-arm.bat` 脚本设计

### 6.1 职责

- 在 WSL2 Docker 中以 **QEMU 模拟 ARM64 模式** 编译 Tauri Linux 客户端
- 产物：`.deb` + `.AppImage`（aarch64）
- 输出到 [`bin/chat-client-xc-arm/`](../bin/chat-client-xc-arm/)

### 6.2 脚本流程

流程与 x86 版本相同（见 5.2 节），**唯一差异**在 Step 3 的 Docker 命令中增加 `--platform linux/arm64`。

### 6.3 核心 Docker 命令

```bash
# WSL2 内执行（注意 --platform linux/arm64）
docker run --rm \
  --platform linux/arm64 \
  -v "$(wslpath -a 'D:\ProjectDir\app-chat'):/app" \
  -w /app/client-chat-tauri \
  node:20-bookworm \
  /bin/bash -c "
    apt-get update &&
    apt-get install -y \
      libsoup-3.0-dev \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      build-essential \
      curl \
      wget &&
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y &&
    source \$HOME/.cargo/env &&
    rustup target add aarch64-unknown-linux-gnu &&
    npm install &&
    npm run tauri build -- --target aarch64-unknown-linux-gnu
  "
```

### 6.4 ARM64 编译性能预估

| 环境 | 首次编译 | 增量编译 |
|------|----------|----------|
| 原生 ARM64 机器 (如树莓派 4) | ~15-30 分钟 | ~3-8 分钟 |
| x86_64 + QEMU 模拟 | **~45-90 分钟** | ~10-30 分钟 |
| 建议 | 耐心等待，或使用 CI | - |

> 💡 如果后续 ARM64 构建频繁，可考虑在 Docker Hub 上构建一个预装好依赖的自定义镜像（`your-registry/tauri-builder:arm64`），将 `apt-get` 和 `rustup` 步骤前置，增量构建只需执行 `npm install && npm run tauri build`。

---

## 7. 产物输出规范

### 7.1 输出目录结构

```
bin/
├── chat-client-xc-x86/          # build-client-x86.bat 产出
│   ├── chat_0.1.0_amd64.deb     # Debian/Ubuntu 安装包
│   ├── chat_0.1.0_amd64.AppImage # 免安装绿色版
│   └── chat_0.1.0_amd64.rpm     # 可选（信创系统较少使用）
│
├── chat-client-xc-arm/          # build-client-arm.bat 产出
│   ├── chat_0.1.0_arm64.deb
│   ├── chat_0.1.0_arm64.AppImage
│   └── chat_0.1.0_arm64.rpm
│
├── chat-client-lan/             # 现有的 Windows 内网版
└── chat-client-tencent/         # 现有的 Windows 腾讯云版
```

### 7.2 产物来源路径

Docker 容器编译完成后，产物位于：

```
<项目根>/client-chat-tauri/src-tauri/target/release/bundle/
├── deb/chat_0.1.0_amd64.deb
├── appimage/chat_0.1.0_amd64.AppImage
└── rpm/chat_0.1.0_amd64.rpm
```

脚本将其复制到对应的 `bin/chat-client-xc-xxx/` 目录。

### 7.3 信创环境安装方式

```bash
# 方式一：安装 .deb（推荐，注册桌面图标 + 启动器）
sudo dpkg -i chat_0.1.0_amd64.deb
# 或
sudo apt install ./chat_0.1.0_amd64.deb

# 方式二：直接运行 AppImage（免安装绿色版）
chmod +x chat_0.1.0_amd64.AppImage
./chat_0.1.0_amd64.AppImage
```

---

## 8. `.bat` 脚本公共设计要素

### 8.1 结构与现有脚本对齐

两份 `.bat` 沿用 [`build-client-lan.bat`](../deploy/build-client-lan.bat) 的风格：

- `@echo off` + `chcp 65001`（UTF-8 中文输出）
- `setlocal enabledelayedexpansion`（延迟变量展开）
- 分段 Step N/M 进度提示（带 emoji 图标）
- 错误码检查 + 常见原因提示
- 末尾 `pause` 等待用户查看结果

### 8.2 WSL2 路径转换

`.bat` 中的 Windows 路径需转换为 WSL2 路径：

```batch
:: %CD% 是 Windows 路径如 D:\ProjectDir\app-chat
:: 在 wsl 命令中作为参数传递：
wsl bash -c "echo Working dir: $(wslpath -a '%PROJECT_ROOT%')"
```

### 8.3 环境变量注入到 Docker

由于 `.env.LAN` 文件已挂载进容器，在 Docker 的 `bash -c` 中执行：

```bash
# 进入 client-chat-tauri 目录，用 .env.LAN 覆盖 .env.production
cp .env.LAN .env.production
npm run tauri build -- --target <target>
```

这样 Vite 在 `beforeBuildCommand` 阶段会自动加载 `.env.LAN` 的网络配置。

### 8.4 错误处理

| 错误场景 | 检测方式 | 提示信息 |
|----------|----------|----------|
| WSL2 未安装 | `wsl --list` 失败 | 提示安装 WSL2 |
| Docker 不可用 | `wsl docker version` 失败 | 提示安装 Docker Desktop 或 WSL2 内 Docker |
| QEMU 未注册 (ARM) | `wsl docker run --platform linux/arm64 node:20-bookworm uname -m` 输出非 `aarch64` | 提示执行 QEMU 安装命令 |
| `.env.LAN` 不存在 | 文件检测 | 提示创建 .env.LAN |
| Tauri 编译失败 | `%errorlevel%` | 显示常见原因 |

### 8.5 支持断点续传

Docker 容器默认 `--rm`（退出后自动删除），如需保留 Rust 编译缓存以加速后续构建，有两种方案：

**方案 A（推荐）：挂载 cargo 缓存目录**

```bash
docker run --rm \
  -v "$(wslpath -a '%PROJECT_ROOT%'):/app" \
  -v "tauri-cargo-x86:/root/.cargo" \    # 命名卷持久化 cargo 缓存
  ...
```

**方案 B：预构建自定义镜像**

将 `apt-get` + `rustup` + `npm install -g @tauri-apps/cli` 预置到镜像中，每次构建只跑 `npm install && tauri build`。

> **一期建议**：先用方案 A（简单有效），等构建频率变高再考虑方案 B。

---

## 9. 待确认事项

| # | 事项 | 确认方 | 影响 |
|---|------|--------|------|
| 1 | 信创目标 OS 的具体发行版？麒麟 V10？统信 UOS 20/21？ | 部署负责人 | 决定 `.deb` 的依赖声明（depends 字段）是否完备 |
| 2 | 信创用户的服务器就是当前 `.env.LAN` 的 `22.188.9.15:8084` 吗？还是需要建新的 `.env.xc`？ | 网络/部署负责人 | 决定复用 `.env.LAN` 还是新建 |
| 3 | ARM64 构建是否需要优化？比如用 CI 或单独购置 ARM 编译机？ | 技术负责人 | 决定是否采纳 6.4 节的优化方案 |
| 4 | 是否需要 `.rpm` 格式？（银河麒麟部分版本用 RPM） | 部署负责人 | 决定 `bundle.targets` 是否排除 rpm |
| 5 | `.bat` 脚本是否要自动安装 QEMU（`qemu-user-static`），还是只检测并提示？ | 技术负责人 | 决定脚本是"自动修复"还是"检测告警"模式 |

---

## 10. 实施步骤（plan 通过后执行）

| # | 步骤 | 产出 |
|---|------|------|
| 1 | 修改 `tauri.conf.json`，添加 `bundle.linux.deb.depends` | 配置更新 |
| 2 | 编写 `deploy/build-client-x86.bat` | 新脚本 |
| 3 | 编写 `deploy/build-client-arm.bat` | 新脚本 |
| 4 | WSL2 中安装 QEMU 并验证 | 环境就绪 |
| 5 | 端到端测试：运行 `.bat` → 产出 .deb → 在信创 VM 中安装验证 | 功能验证 |
| 6 | 补充文档 `docs/DEPLOYMENT.md` 信创客户端分发章节 | 文档更新 |

---

> 📌 **本 plan 完成后，请审阅第 9 节的待确认事项，给出明确答复后进入实施阶段。**
