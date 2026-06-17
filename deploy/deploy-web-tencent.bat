@echo off
chcp 65001 >nul 2>&1
title 🌐 部署 Web SPA → 腾讯云
setlocal enabledelayedexpansion

echo ==================================================
echo   🌐 部署 Web 前端 → 腾讯云 HTTPS
echo ==================================================
echo.

:: 腾讯云服务器参数（按需修改）
set "SERVER_IP=129.211.9.238"
set "DOMAIN=realapex.site"
set "SERVER_USER=root"
set "REMOTE_WEB_DIR=/var/www/app-chat/dist"
set "REMOTE_NGINX_CONF=/etc/nginx/conf.d/app-chat.conf"

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

:: ========== Step 1: 校验项目文件 ==========
echo [1/4] 📋 校验项目文件...
if not exist "client-chat-tauri\package.json" (
    echo ❌ 未找到 client-chat-tauri\package.json！
    pause
    exit /b 1
)
if not exist "client-chat-tauri\.env.production" (
    echo ❌ 未找到 client-chat-tauri\.env.production！
    pause
    exit /b 1
)
if not exist "deploy\nginx-chat.conf" (
    echo ❌ 未找到 deploy\nginx-chat.conf！
    pause
    exit /b 1
)
echo ✅ 所有源文件就绪
echo.

:: ========== Step 2: 构建 Vue SPA ==========
echo [2/4] ⚡ 构建 Vue 前端（读取 .env.production）...

cd /d "%PROJECT_ROOT%\client-chat-tauri"

echo   后端地址: 由 .env.production 中的 VITE_GO_BASE_URL 指定
echo.

echo ==================================================
echo   Vite 正在编译...
echo ==================================================
echo.

call npm run build
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

:: ========== Step 3: 上传到腾讯云服务器 ==========
echo [3/4] 🚀 上传前端产物到腾讯云...

cd /d "%PROJECT_ROOT%"

set "DIST_DIR=%PROJECT_ROOT%\client-chat-tauri\dist"

if not exist "%DIST_DIR%" (
    echo ❌ 未找到构建产物 %DIST_DIR%
    pause
    exit /b 1
)

:: 3.1 远程清理旧文件 + 创建目录
echo   远程清理旧 Web 文件 + 创建目录...
ssh "%SERVER_USER%@%SERVER_IP%" "rm -rf %REMOTE_WEB_DIR%; mkdir -p %REMOTE_WEB_DIR%"
if %errorlevel% neq 0 (
    echo ❌ SSH 连接失败！请检查免密登录配置或服务器 IP。
    pause
    exit /b 1
)

:: 3.2 上传 dist 目录内所有文件
echo   上传 dist/* → %REMOTE_WEB_DIR%/
scp -r "%DIST_DIR%\*" "%SERVER_USER%@%SERVER_IP%:%REMOTE_WEB_DIR%/"
if %errorlevel% neq 0 (
    echo ❌ 前端文件上传失败！请检查 SSH 连接和磁盘空间。
    pause
    exit /b 1
)
echo ✅ 前端文件上传完成
echo.

:: 3.3 上传 Nginx 配置
echo   上传 Nginx 配置 → %REMOTE_NGINX_CONF%
scp "%PROJECT_ROOT%\deploy\nginx-chat.conf" "%SERVER_USER%@%SERVER_IP%:%REMOTE_NGINX_CONF%"
if %errorlevel% neq 0 (
    echo ❌ Nginx 配置上传失败！
    pause
    exit /b 1
)
echo.

:: 3.4 远程重载 Nginx
echo   远程校验并重载 Nginx...
ssh "%SERVER_USER%@%SERVER_IP%" "nginx -t && nginx -s reload"
if %errorlevel% neq 0 (
    echo ❌ Nginx 重载失败！请检查 nginx-chat.conf 语法。
    pause
    exit /b 1
)
echo ✅ Nginx 已重载
echo.

:: ========== Step 4: 完成 ==========
echo ==================================================
echo   🏁  Web 前端部署完成！
echo ==================================================
echo.
echo   📌 访问地址:
echo      https://%DOMAIN%:8094/
echo.
echo   📌 部署架构:
echo      浏览器 → HTTPS :8094 (Nginx)
echo        ├── /               → 静态文件 /var/www/app-chat/dist/
echo        ├── /api/*          → 反代 Go :8194
echo        ├── /ws             → WebSocket Go :8194
echo        └── /uploads/*      → 反代 Go :8194
echo.
echo   📌 后续更新前端:
echo      仅需重新运行本脚本，无需重启 Go 后端或 Nginx
echo ==================================================
echo.

cd /d "%PROJECT_ROOT%"
pause
exit /b 0
