@echo off
chcp 65001 >nul
REM ========================================
REM   ChatServer 服务 重启脚本
REM   未安装 → 先安装再启动
REM   已停止 → 直接启动
REM   已启动 → 先停止再启动 (重启)
REM ========================================

REM 1. 检查服务是否已注册，未注册则安装
.\ChatServer.exe status >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] 服务未注册，正在安装...
    .\ChatServer.exe install
    if %errorlevel% neq 0 (
        echo [ERROR] 服务安装失败，请以管理员身份运行！
        pause
        exit /b 1
    )
    echo [OK] 服务安装成功
)

REM 2. 查询当前服务状态并决定操作
.\ChatServer.exe status 2>nul | findstr /i "running" >nul
if %errorlevel% equ 0 (
    echo [INFO] 服务正在运行，先停止...
    .\ChatServer.exe stop
    if %errorlevel% neq 0 (
        echo [ERROR] 停止服务失败！
        pause
        exit /b 1
    )
    echo [OK] 服务已停止
    REM 等一秒让端口释放
    timeout /t 1 /nobreak >nul
) else (
    echo [INFO] 服务未运行
)

REM 3. 启动服务
echo [INFO] 正在启动服务...
.\ChatServer.exe start
if %errorlevel% neq 0 (
    echo [ERROR] 启动服务失败！
    pause
    exit /b 1
)
echo [OK] ChatServer 服务已成功启动！
pause