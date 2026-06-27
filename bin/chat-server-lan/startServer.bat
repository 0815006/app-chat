@echo off
chcp 65001 >nul 2>&1
echo ==========================================
echo   启动 Chat Server 服务
echo   工作目录: D:\app\chat-server
echo ==========================================
echo.

:: 切到部署目录
cd /d "D:\app\chat-server"

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
  访问: http://localhost:8094/api/ping
echo ==========================================
pause
