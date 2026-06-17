@echo off
chcp 65001 >nul 2>&1
title 🔨 构建 Web 版本 → 内网部署
setlocal enabledelayedexpansion

echo ==================================================
echo   🔨 构建 Web 内网版本（一个 exe 跑全部）
echo ==================================================
echo.

:: ========== 📌 内网部署参数（改内网只改这里） ==========
set "CHAT_SERVER_MODE=release"
set "DB_HOST=22.188.9.144"
set "DB_PORT=3306"
set "DB_USER=root"
set "DB_PASSWORD=Star002^!"
set "DB_NAME=chat_db"
set "REDIS_ENABLE=false"
set "JWT_SECRET=go-chat-server-prod-jwt-secret-change-me"
set "UPLOAD_DIR=D:/data/chat-server/uploads"
:: url_prefix 不设 — main.go 启动时自动检测本机 IP 生成
:: ========================================================

:: 切到项目根目录
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"
if %errorlevel% neq 0 (
    echo ❌ 无法进入项目根目录！
    pause
    exit /b 1
)
echo 📁 项目根目录: %cd%
echo.

:: ========== Step 1: 校验项目 ==========
echo [1/5] 📋 校验项目文件...
if not exist "client-chat-tauri\package.json" (
    echo ❌ 未找到 client-chat-tauri\package.json！
    pause
    exit /b 1
)
if not exist "go-chat-server\main.go" (
    echo ❌ 未找到 go-chat-server\main.go！
    pause
    exit /b 1
)
if not exist "go-chat-server\config\config.yaml" (
    echo ❌ 未找到 go-chat-server\config\config.yaml！
    pause
    exit /b 1
)
echo ✅ 所有源文件就绪
echo.
echo 📌 内网部署参数:
echo    mode=%CHAT_SERVER_MODE%
echo    DB=%DB_HOST%:%DB_PORT%/%DB_NAME%
echo    Redis=%REDIS_ENABLE%
echo    upload=%UPLOAD_DIR%
echo.

:: ========== Step 2: 构建前端 dist ==========
echo [2/5] ⚡ 构建 Vue 前端（LAN 内网配置 — 同源自适应，无需硬编码 IP）...

cd /d "%PROJECT_ROOT%\client-chat-tauri"

echo.
echo ==================================================
echo   Vite 正在编译（首次约 30-60 秒）...
echo   mode: lan-server → 继承 .env 基线，前后端同源
echo ==================================================
echo.

call npm run build:lan-server
set BUILD_RESULT=%errorlevel%

if %BUILD_RESULT% neq 0 (
    echo.
    echo ❌ 前端构建失败！
    pause
    exit /b 1
)
echo.
echo ✅ 前端构建完成
echo.

:: ========== Step 3: 复制 dist 到 Go 后端 ==========
echo [3/5] 📦 复制前端产物到 Go 后端...

set "DIST_SRC=%PROJECT_ROOT%\client-chat-tauri\dist"
set "DIST_DST=%PROJECT_ROOT%\go-chat-server\frontend\dist"

if not exist "%DIST_SRC%" (
    echo ❌ 未找到构建产物 %DIST_SRC%
    pause
    exit /b 1
)

:: 清空目标目录并重新复制
if exist "%DIST_DST%" (
    rmdir /s /q "%DIST_DST%"
)
mkdir "%DIST_DST%" >nul 2>&1

xcopy /e /y /q "%DIST_SRC%\*" "%DIST_DST%\" >nul
echo   已复制: %DIST_SRC% → %DIST_DST%
echo.

:: ========== Step 4: 编译 Go 后端 ==========
echo [4/5] 🐹 编译 Go 后端（内嵌前端）...

cd /d "%PROJECT_ROOT%\go-chat-server"

if not exist "main.go" (
    echo ❌ 未找到 go-chat-server\main.go！
    pause
    exit /b 1
)

echo   目标: Windows amd64
echo   输出: go-chat-server.exe
echo.

set "GO_OUT=go-chat-server.exe"
go build -ldflags "-s -w" -o "%GO_OUT%" .
if %errorlevel% neq 0 (
    echo.
    echo ❌ Go 编译失败！
    pause
    exit /b 1
)
echo ✅ Go 编译完成
echo.

:: ========== Step 5: 汇总产物 ==========
echo [5/5] 📋 汇总...

set "OUT_DIR=%PROJECT_ROOT%\bin\内网版本\chat-server"

:: 创建输出目录结构
if not exist "%OUT_DIR%\config" mkdir "%OUT_DIR%\config" >nul 2>&1

:: 复制 Go 二进制
if exist "%GO_OUT%" (
    echo   复制 %GO_OUT% → %OUT_DIR%
    copy /y "%GO_OUT%" "%OUT_DIR%\%GO_OUT%" >nul
)

:: 构建时展开 config.yaml（${VAR:default} → 内网实际值）
echo   展开 config.yaml（注入内网参数）→ %OUT_DIR%\config\config.yaml
"%GO_OUT%" --expand-config "%OUT_DIR%\config\config.yaml"
if %errorlevel% neq 0 (
    echo ❌ 配置文件展开失败！
    pause
    exit /b 1
)

echo.
echo ==================================================
echo   🏁  构建完成！内网 Web 全合一版本
echo ==================================================
echo.
echo   📌 最终产物目录: %OUT_DIR%\
echo         ├── %GO_OUT%          (含 Go API + Vue 前端)
echo         ├── config\
echo         │   └── config.yaml   (内置内网实际参数)
echo         ├── ChatServer.exe    (WinSW)
echo         ├── ChatServer.xml    (WinSW 服务定义)
echo         ├── startServer.bat
echo         └── stopServer.bat
echo.
echo   📌 部署方式:
echo       1. 将整个 chat-server 目录复制到内网服务器
echo       2. 以管理员运行 startServer.bat 注册并启动服务
echo       3. 浏览器访问 http://服务器IP:8194
echo.
echo   💡 修改内网参数：编辑本 bat 头部 set 变量，重新构建即可
echo      go-chat-server.exe 同时提供：
echo      - Go API 后端 (HTTP + WebSocket，端口 8194)
echo      - Vue 前端 SPA (内嵌，/ 路径)
echo ==================================================
echo.

cd /d "%PROJECT_ROOT%"
pause
exit /b 0
