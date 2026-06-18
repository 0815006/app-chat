@echo off
chcp 65001 >nul
cls

echo ==================================================
echo   🚀 IM 聊天后端 [端口: 8094] 正在接入本地常驻中间件...
echo ==================================================
echo.

:: 切到 Go 后端项目根目录（本 bat 放在 deploy/ 下）
cd /d "%~dp0..\go-chat-server"

:: ---------- 环境自检 ----------
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Go 环境，请先安装 Go SDK。
    pause
    exit /b 1
)

echo 📋 当前配置一览：
echo    MySQL  : 127.0.0.1:3306 / chat_db
echo    Redis  : 127.0.0.1:6379 / db:0
echo    服务端口: 8094
echo.
echo 💡 提示：
echo    1. 请确保本地 MySQL 已创建空库 chat_db（字符集 utf8mb4）
echo    2. Redis db 号可在 config\config.yaml 中改为 7/8 以隔离缓存
echo    3. GORM 启动时会自动建表，不会动你其他库
echo --------------------------------------------------

:: ---------- 编译 ----------
echo.
echo 🛠️  正在编译 server.exe ...
go build -ldflags "-s -w" -o server.exe .

if %errorlevel% neq 0 (
    echo.
    echo ❌ 编译失败！请根据上方错误信息修复 Go 源码。
    pause
    exit /b 1
)

:: ---------- 启动 ----------
echo.
echo ✅ 编译成功！正在拉起 Go 后端...
echo 📡 API 基址 : http://127.0.0.1:8094
echo 📡 WebSocket: ws://127.0.0.1:8094/ws
echo 📡 健康检查: http://127.0.0.1:8094/api/ping
echo.
echo ==================================================
echo   ██████  后端运行中（前台模式，Ctrl+C 停止）
echo ==================================================
echo.

server.exe

pause
