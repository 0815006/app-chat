# =================================================================
#        🔨 构建 Web 版本 → 内网部署（PowerShell 版）
#        由 build-server-lan.bat 改写而来，功能完全一致
#        所有产物均由脚本动态生成，无需手动维护静态文件
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
$ServerPort      = 8094
$DeployDir       = "D:\app\chat-server"
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

# ========== Step 1: 校验项目文件 ==========
Write-Host "[1/7] 📋 校验项目文件..." -ForegroundColor Yellow

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
Write-Host "   Server:  :$ServerPort"
Write-Host "   DB:      $env:DB_HOST`:$env:DB_PORT/$env:DB_NAME"
Write-Host "   Redis:   $env:REDIS_ENABLE"
Write-Host "   Upload:  $env:UPLOAD_DIR"
Write-Host "   Deploy:  $DeployDir"
Write-Host ""

# ========== Step 2: 构建前端 dist ==========
Write-Host "[2/7] ⚡ 构建 Vue 前端（同源自适应，无需硬编码 IP）..." -ForegroundColor Yellow

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
Write-Host "[3/7] 📦 复制前端产物到 Go 后端..." -ForegroundColor Yellow

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
Write-Host "[4/7] 🐹 编译 Go 后端（内嵌前端）..." -ForegroundColor Yellow

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
Pop-Location

# ========== Step 5: 准备输出目录 + 复制 Go 二进制 + 展开 config.yaml ==========
Write-Host "[5/7] 📦 准备输出目录..." -ForegroundColor Yellow

$OutDir = "$ProjectRoot\bin\chat-server-lan"

# 清空并重建输出目录
if (Test-Path $OutDir) {
    Remove-Item -Recurse -Force $OutDir
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
New-Item -ItemType Directory -Force "$OutDir\config" | Out-Null

# 复制 Go 二进制
Copy-Item -Force "$ProjectRoot\go-chat-server\$GO_OUT" "$OutDir\$GO_OUT"
Write-Host "  复制 $GO_OUT → $OutDir\"

# 构建时展开 config.yaml（${VAR:default} → 内网实际值）
# 必须在 go-chat-server 目录下执行，--expand-config 会查找 ./config/config.yaml 模板
Write-Host "  展开 config.yaml（注入内网参数）→ $OutDir\config\config.yaml"
Push-Location "$ProjectRoot\go-chat-server"
& "$ProjectRoot\go-chat-server\$GO_OUT" --expand-config "$OutDir\config\config.yaml"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 配置文件展开失败！" -ForegroundColor Red
    Pop-Location
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Pop-Location
Write-Host "  ✅ 配置文件已展开"
Write-Host ""

# ========== Step 6: 生成 WinSW 服务定义 + 启停辅助脚本 ==========
Write-Host "[6/7] ⚙️  生成 WinSW 服务定义及启停脚本..." -ForegroundColor Yellow
Write-Host "  部署目录: $DeployDir"

# ---- ChatServer.xml (WinSW 服务定义) ----
$xmlContent = @"
<service>
  <id>ChatServer</id>
  <name>Go Chat Server Backend</name>
  <description>Tauri 聊天软件的 Go 原生后端常驻服务</description>
  <executable>$DeployDir\go-chat-server.exe</executable>
  <workingdirectory>$DeployDir</workingdirectory>
  <logmode>rotate</logmode>
  <startmode>Automatic</startmode>
</service>
"@
$xmlContent | Out-File -FilePath "$OutDir\ChatServer.xml" -Encoding utf8
Write-Host "  ✅ ChatServer.xml 已生成"

# ---- startServer.bat (安装 + 启动服务) ----
$startBat = @"
@echo off
chcp 65001 >nul 2>&1
echo ==========================================
echo   启动 Chat Server 服务
echo   工作目录: $DeployDir
echo ==========================================
echo.

:: 切到部署目录
cd /d "$DeployDir"

:: 需要以管理员身份运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 请以管理员身份运行此脚本！
    pause
    exit /b 1
)

echo [1/3] 安装服务...
ChatServer.exe install
if %errorlevel% neq 0 (
    echo 提示: 服务可能已安装，尝试直接启动...
)

echo [2/3] 启动服务...
ChatServer.exe start
if %errorlevel% neq 0 (
    echo ❌ 服务启动失败！
    pause
    exit /b 1
)

echo [3/3] 校验服务状态...
ChatServer.exe status

echo ==========================================
echo   ✅ Chat Server 服务已启动
echo   访问: http://localhost:${ServerPort}/api/ping
echo ==========================================
pause
"@
$startBat | Out-File -FilePath "$OutDir\startServer.bat" -Encoding ascii
Write-Host "  ✅ startServer.bat 已生成"

# ---- stopServer.bat (停止 + 卸载服务) ----
$stopBat = @"
@echo off
chcp 65001 >nul 2>&1
echo ==========================================
echo   停止 Chat Server 服务
echo   工作目录: $DeployDir
echo ==========================================
echo.

:: 切到部署目录
cd /d "$DeployDir"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 请以管理员身份运行此脚本！
    pause
    exit /b 1
)

echo 正在停止服务...
ChatServer.exe stop
echo.
echo 正在卸载服务...
ChatServer.exe uninstall
echo.
echo ✅ 服务已停止并卸载
pause
"@
$stopBat | Out-File -FilePath "$OutDir\stopServer.bat" -Encoding ascii
Write-Host "  ✅ stopServer.bat 已生成"
Write-Host ""

# ========== Step 7: 复制 WinSW 可执行文件 ==========
Write-Host "[7/7] ⚙️  复制 WinSW 可执行文件..." -ForegroundColor Yellow

$WinSW = "$ProjectRoot\deploy\WinSW-x64.exe"
$WinSWDest = "$OutDir\ChatServer.exe"

if (Test-Path $WinSW) {
    Copy-Item -Force $WinSW $WinSWDest
    Write-Host "  deploy\WinSW-x64.exe → $OutDir\ChatServer.exe"
    Write-Host "  ✅ WinSW 已自动部署" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  未找到 deploy\WinSW-x64.exe，请从以下地址下载后放入 deploy 目录:" -ForegroundColor Yellow
    Write-Host "     https://github.com/winsw/winsw/releases"
}
Write-Host ""

# ========== 输出完成信息 ==========
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  🏁  构建完成！内网 Web 全合一版本" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  📌 构建产物目录: $OutDir\"
Write-Host "        ├── $GO_OUT          (含 Go API + Vue 前端)"
Write-Host "        ├── config\"
Write-Host "        │   └── config.yaml   (内置内网实际参数)"
Write-Host "        ├── ChatServer.exe    (WinSW 可执行文件)"
Write-Host "        ├── ChatServer.xml    (WinSW 服务定义)"
Write-Host "        ├── startServer.bat   (安装 + 启动)"
Write-Host "        └── stopServer.bat    (停止 + 卸载)"
Write-Host ""
Write-Host "  📌 部署步骤:"
Write-Host "      1. 将 $OutDir\ 下所有文件复制到 $DeployDir\"
Write-Host "      2. 以管理员身份运行 $DeployDir\startServer.bat"
Write-Host "      3. 浏览器验证: http://localhost:${ServerPort}/api/ping"
Write-Host ""
Write-Host "  💡 修改内网参数: 编辑本 ps1 头部变量，重新构建即可"
Write-Host "     go-chat-server.exe 同时提供："
Write-Host "     - Go API 后端 (HTTP + WebSocket，端口 $ServerPort)"
Write-Host "     - Vue 前端 SPA (内嵌，/ 路径)"
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

Pop-Location
Read-Host "按回车键退出..."
exit 0
