@echo off
chcp 65001 >nul
REM ========================================
REM   ChatServer 服务 停止并卸载脚本
REM   已启动 → 先停止
REM   已注册 → 卸载删除
REM ========================================

REM 1. 检查服务是否已注册，没注册直接结束
.\ChatServer.exe status >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] 服务未注册，无需操作
    pause
    exit /b 0
)

REM 2. 如果正在运行，先停止
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
)

REM 3. 卸载服务
echo [INFO] 正在卸载服务...
.\ChatServer.exe uninstall
if %errorlevel% neq 0 (
    echo [ERROR] 卸载服务失败！
    pause
    exit /b 1
)
echo [OK] ChatServer 服务已成功卸载！
pause
