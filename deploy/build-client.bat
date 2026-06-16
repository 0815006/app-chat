@echo off
title 打包 Tauri 桌面客户端
chcp 65001 >nul 2>&1

echo ==================================================
echo   🔨 打包 Tauri 桌面客户端 → 腾讯云生产环境
echo ==================================================
echo.

:: 切到前端项目根目录（本 bat 放在 deploy/ 下）
cd /d "%~dp0..\client-chat-tauri"
if %errorlevel% neq 0 (
    echo ❌ 无法进入 client-chat-tauri 目录！
    pause
    exit /b 1
)
echo 📁 工作目录: %cd%
echo.

:: ========== 1. 校验 .env.production ==========
echo [1/2] 📋 校验 .env.production 云端配置...
echo.

if not exist ".env.production" (
    echo ❌ 未找到 .env.production 文件！
    pause
    exit /b 1
)

echo 当前 .env.production 内容:
echo ----------------------------------------
type .env.production
echo ----------------------------------------
echo.

:: ========== 2. 编译打包 ==========
echo [2/2] ⚡ 正在编译 Tauri 桌面客户端...
echo.
echo   首次编译约 5-15 分钟，增量编译约 1-3 分钟
echo   如卡住不动是正常的（Rust 正在编译依赖）
echo   连接后端: 腾讯云 HTTPS :8094
echo.
echo ==================================================
echo   ██████  构建进行中，请耐心等待...
echo ==================================================
echo.

call npm run tauri:build

if %errorlevel% neq 0 (
    echo.
    echo ==================================================
    echo   ❌ 打包失败！错误码: %errorlevel%
    echo ==================================================
    echo.
    echo   常见原因:
    echo     1. 缺少 Visual Studio Build Tools (C++ 工具链)
    echo     2. 缺少 WebView2 Runtime (Win10 以下)
    echo     3. Rust 版本过旧: rustup update
    echo     4. node_modules 未安装: npm install
    echo.
    pause
    exit /b 1
)

echo.
echo ==================================================
echo   🏁  打包成功！
echo ==================================================
echo.
echo   📌 绿色免安装版:
echo      %cd%\src-tauri\target\release\client-chat-tauri.exe
echo.
echo   📌 MSI 安装包:
echo      %cd%\src-tauri\target\release\bundle\msi\
echo.
echo --------------------------------------------------
echo   💡 提示:
echo      1. 用户运行 .exe 无需安装任何依赖
echo      2. 客户端会自动连接腾讯云 HTTPS :8094
echo      3. 发给用户前建议先在本机测试运行
echo ==================================================
echo.

pause
exit /b 0
