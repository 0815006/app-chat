# =================================================================
#        🔨 构建 Web 版本 → 内网部署（PowerShell 版）
#        由 build-server-lan.bat 改写而来，功能完全一致
#
#  运行方式（任选）:
#    1. 右键 → 使用 PowerShell 运行
#    2. 如遇执行策略限制:
#       powershell -ExecutionPolicy Bypass -File .\build-server-lan.ps1
# =================================================================
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "🔨 构建 Web 版本 → 内网部署"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  🔨 构建 Web 内网版本（一个 exe 跑全部）" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# ─── 📌 内网部署参数（改内网只改这里）────────────────────────────
# 必须用 $env: 前缀，Go 二进制 --expand-config 通过 os.Getenv() 读取
$env:CHAT_SERVER_MODE = "release"
$env:DB_HOST     = "22.188.9.144"
$env:DB_PORT     = "3306"
$env:DB_USER     = "root"
$env:DB_PASSWORD = "Star002!"
$env:DB_NAME     = "chat_db"
$env:REDIS_ENABLE = "false"
$env:JWT_SECRET  = "go-chat-server-prod-jwt-secret-change-me"
$env:UPLOAD_DIR  = "D:/data/chat-server/uploads"
# url_prefix 不设 — main.go 启动时自动检测本机 IP 生成
# ────────────────────────────────────────────────────────────────

# 切到项目根目录
$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
Push-Location $ProjectRoot

if (-not $?) {
    Write-Host "❌ 无法进入项目根目录！" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "📁 项目根目录: $((Get-Location).Path)"
Write-Host ""

# ========== Step 1: 校验项目 ==========
Write-Host "[1/5] 📋 校验项目文件..." -ForegroundColor Yellow

if (-not (Test-Path "client-chat-tauri\package.json")) {
    Write-Host "❌ 未找到 client-chat-tauri\package.json！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
if (-not (Test-Path "go-chat-server\main.go")) {
    Write-Host "❌ 未找到 go-chat-server\main.go！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
if (-not (Test-Path "go-chat-server\config\config.yaml")) {
    Write-Host "❌ 未找到 go-chat-server\config\config.yaml！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "✅ 所有源文件就绪" -ForegroundColor Green
Write-Host ""
Write-Host "📌 内网部署参数:"
Write-Host "   mode=$env:CHAT_SERVER_MODE"
Write-Host "   DB=$env:DB_HOST`:$env:DB_PORT/$env:DB_NAME"
Write-Host "   Redis=$env:REDIS_ENABLE"
Write-Host "   upload=$env:UPLOAD_DIR"
Write-Host ""

# ========== Step 2: 构建前端 dist ==========
Write-Host "[2/5] ⚡ 构建 Vue 前端（同源自适应，无需硬编码 IP）..." -ForegroundColor Yellow

Push-Location "$ProjectRoot\client-chat-tauri"

Write-Host ""
Write-Host "=================================================="
Write-Host "  Vite 正在编译（首次约 30-60 秒）..."
Write-Host "  mode: web-spa → 继承 .env 基线，前后端同源"
Write-Host "=================================================="
Write-Host ""

& npm run build:web-spa
$BuildResult = $LASTEXITCODE

if ($BuildResult -ne 0) {
    Write-Host ""
    Write-Host "❌ 前端构建失败！" -ForegroundColor Red
    Pop-Location
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host ""
Write-Host "✅ 前端构建完成" -ForegroundColor Green
Write-Host ""
Pop-Location

# ========== Step 3: 复制 dist 到 Go 后端 ==========
Write-Host "[3/5] 📦 复制前端产物到 Go 后端..." -ForegroundColor Yellow

$DistSrc = "$ProjectRoot\client-chat-tauri\dist"
$DistDst = "$ProjectRoot\go-chat-server\frontend\dist"

if (-not (Test-Path $DistSrc)) {
    Write-Host "❌ 未找到构建产物 $DistSrc" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}

# 清空目标目录并重新复制
if (Test-Path $DistDst) {
    Remove-Item -Recurse -Force $DistDst
}
New-Item -ItemType Directory -Force $DistDst | Out-Null

Copy-Item -Recurse -Force "$DistSrc\*" $DistDst
Write-Host "  已复制: $DistSrc → $DistDst"
Write-Host ""

# ========== Step 4: 编译 Go 后端 ==========
Write-Host "[4/5] 🐹 编译 Go 后端（内嵌前端）..." -ForegroundColor Yellow

Push-Location "$ProjectRoot\go-chat-server"

if (-not (Test-Path "main.go")) {
    Write-Host "❌ 未找到 go-chat-server\main.go！" -ForegroundColor Red
    Pop-Location
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}

Write-Host "  目标: Windows amd64"
Write-Host "  输出: go-chat-server.exe"
Write-Host ""

$GO_OUT = "go-chat-server.exe"
& go build -ldflags "-s -w" -o $GO_OUT .

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Go 编译失败！" -ForegroundColor Red
    Pop-Location
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "✅ Go 编译完成" -ForegroundColor Green
Write-Host ""

# ========== Step 5: 汇总产物 ==========
Write-Host "[5/5] 📋 汇总..." -ForegroundColor Yellow

$OutDir = "$ProjectRoot\bin\内网版本\chat-server"

# 创建输出目录结构
if (-not (Test-Path "$OutDir\config")) {
    New-Item -ItemType Directory -Force "$OutDir\config" | Out-Null
}

# 复制 Go 二进制
if (Test-Path $GO_OUT) {
    Write-Host "  复制 $GO_OUT → $OutDir"
    Copy-Item -Force $GO_OUT "$OutDir\$GO_OUT"
}

# 构建时展开 config.yaml（${VAR:default} → 内网实际值）
Write-Host "  展开 config.yaml（注入内网参数）→ $OutDir\config\config.yaml"
& ".\$GO_OUT" --expand-config "$OutDir\config\config.yaml"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 配置文件展开失败！" -ForegroundColor Red
    Pop-Location
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}

Pop-Location

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  🏁  构建完成！内网 Web 全合一版本" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  📌 最终产物目录: $OutDir\"
Write-Host "        ├── $GO_OUT          (含 Go API + Vue 前端)"
Write-Host "        ├── config\"
Write-Host "        │   └── config.yaml   (内置内网实际参数)"
Write-Host "        ├── ChatServer.exe    (WinSW)"
Write-Host "        ├── ChatServer.xml    (WinSW 服务定义)"
Write-Host "        ├── startServer.bat"
Write-Host "        └── stopServer.bat"
Write-Host ""
Write-Host "  📌 部署方式:"
Write-Host "      1. 将整个 chat-server 目录复制到内网服务器"
Write-Host "      2. 以管理员运行 startServer.bat 注册并启动服务"
Write-Host "      3. 浏览器访问 http://服务器IP:8094"
Write-Host ""
Write-Host "  💡 修改内网参数: 编辑本 ps1 头部 `$env:变量，重新构建即可"
Write-Host "     go-chat-server.exe 同时提供："
Write-Host "     - Go API 后端 (HTTP + WebSocket，端口 8094)"
Write-Host "     - Vue 前端 SPA (内嵌，/ 路径)"
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

Pop-Location
Read-Host "按回车键退出..."
exit 0
