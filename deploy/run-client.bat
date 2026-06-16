@echo off
chcp 65001 >nul
cls

echo ==================================================
echo   📦 正在启动前端开发服务器 [端口: 8084]...
echo ==================================================
echo.

:: 切到前端项目根目录（本 bat 放在 deploy/ 下）
cd /d "%~dp0..\client-chat-tauri"

:: ---------- 修正后端端口 ----------
:: .env 文件已配置为 8194，Go 后端也监听 8194；这里用环境变量二次兜底
:: 这里用环境变量强行覆盖，Vite 会在 loadEnv 阶段拾取
set VITE_GO_BASE_URL=http://127.0.0.1:8194
set VITE_GO_WS_URL=ws://127.0.0.1:8194/ws

echo 🔗 后端连接已修正：
echo    API       → %VITE_GO_BASE_URL%
echo    WebSocket → %VITE_GO_WS_URL%
echo.

:: ---------- 依赖检查 ----------
if not exist "node_modules\" (
    echo ⚠️  首次运行，正在安装前端依赖（npm install）...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo ❌ 依赖安装失败！请检查 Node.js 与网络。
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成！
    echo.
)

:: ---------- 启动 Vite 开发服务器 ----------
echo 🚀 正在启动 Vite 开发服务器...
echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  📌 浏览器打开 http://localhost:8084            ║
echo ║  📌 API 代理已自动转发到 → http://127.0.0.1:8194 ║
echo ║  ⚡ 先启动 run-backend.bat，再启动本脚本          ║
echo ╚════════════════════════════════════════════════════╝
echo.
echo ==================================================
echo   ██████  前端开发服务器运行中（Ctrl+C 停止）
echo ==================================================
echo.

call npm run tauri:dev

pause
