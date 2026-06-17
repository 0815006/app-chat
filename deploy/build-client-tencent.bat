@echo off
title 🔨 打包 Tauri 桌面客户端 → 腾讯云
chcp 65001 >nul 2>&1

:: =================================================================
::  📌 腾讯云地址参数 → 编辑 client-chat-tauri\.env.production
::     VITE_GO_BASE_URL=https://realapex.site:8084
::     VITE_GO_WS_URL=wss://realapex.site:8084/ws
::     （架构：客户端 → Nginx :8084 → 反代 Go :8094）
:: =================================================================

echo ==================================================
echo   🔨 打包 Tauri 桌面客户端 → 腾讯云生产环境
echo ==================================================
echo.

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

:: ========== Step 1: 校验 .env.production ==========
echo [1/3] 📋 校验 .env.production 腾讯云配置...
echo.

if not exist "client-chat-tauri\.env.production" (
    echo ❌ 未找到 client-chat-tauri\.env.production 文件！
    pause
    exit /b 1
)

echo 当前 .env.production 内容:
echo ----------------------------------------
type "client-chat-tauri\.env.production"
echo ----------------------------------------
echo.

:: ========== Step 2: 编译打包 ==========
echo [2/3] ⚡ 正在编译 Tauri 桌面客户端...

cd /d "%PROJECT_ROOT%\client-chat-tauri"

echo   首次编译约 5-15 分钟，增量编译约 1-3 分钟
echo   如卡住不动是正常的（Rust 正在编译依赖）
echo   连接后端: 腾讯云 HTTPS :8084
echo.
echo ==================================================
echo   ██████  构建进行中，请耐心等待...
echo ==================================================
echo.

call npm run tauri:build
set BUILD_RESULT=%errorlevel%

if %BUILD_RESULT% neq 0 (
    echo.
    echo ==================================================
    echo   ❌ 打包失败！错误码: %BUILD_RESULT%
    echo ==================================================
    echo.
    echo   常见原因:
    echo     1. 缺少 Visual Studio Build Tools ^(C++ 工具链^)
    echo     2. 缺少 WebView2 Runtime ^(Win10 以下^)
    echo     3. Rust 版本过旧: rustup update
    echo     4. node_modules 未安装: npm install
    echo.
    pause
    exit /b 1
)
echo.
echo ✅ Tauri 编译完成
echo.

:: ========== Step 3: 汇总产物到 bin/腾讯云版本/ ==========
echo [3/3] 📋 汇总构建产物...

cd /d "%PROJECT_ROOT%"

set "SRC_EXE=%PROJECT_ROOT%\client-chat-tauri\src-tauri\target\release\client-chat-tauri.exe"
set "SRC_BUNDLE=%PROJECT_ROOT%\client-chat-tauri\src-tauri\target\release\bundle"
set "OUT_DIR=%PROJECT_ROOT%\bin\腾讯云版本"

:: 确保输出目录存在
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%" >nul 2>&1

:: 复制免安装 exe
if exist "%SRC_EXE%" (
    echo   复制 client-chat-tauri.exe → %OUT_DIR%\
    copy /y "%SRC_EXE%" "%OUT_DIR%\client-chat-tauri.exe" >nul
) else (
    echo   ⚠️ 未找到 client-chat-tauri.exe（可能 Rust 编译产物路径有变）
)

:: 复制 MSI 安装包
if exist "%SRC_BUNDLE%\msi\" (
    for %%f in ("%SRC_BUNDLE%\msi\*.msi") do (
        echo   复制 %%~nxf → %OUT_DIR%\
        copy /y "%%f" "%OUT_DIR%\" >nul
    )
    for %%f in ("%SRC_BUNDLE%\msi\*-setup.exe") do (
        echo   复制 %%~nxf → %OUT_DIR%\
        copy /y "%%f" "%OUT_DIR%\" >nul
    )
) else (
    echo   ⚠️ 未找到 MSI 安装包
)

echo.
echo ==================================================
echo   🏁  构建完成！腾讯云 Tauri 桌面客户端
echo ==================================================
echo.
echo   📌 最终产物目录: %OUT_DIR%\
if exist "%OUT_DIR%\client-chat-tauri.exe" (
    echo         ├── client-chat-tauri.exe  ^(绿色免安装版^)
)
if exist "%OUT_DIR%\Chat_*.msi" (
    echo         ├── Chat_*.msi             ^(MSI 安装包^)
    echo         └── Chat_*-setup.exe       ^(安装引导程序^)
)
echo.
echo   📌 安装方式（任选其一）:
echo       1. 直接运行 client-chat-tauri.exe（免安装绿色版）
echo       2. 双击 Chat_*.msi 安装到系统
echo.
echo   📌 客户端会自动连接: 腾讯云 HTTPS :8084
echo ==================================================
echo.

cd /d "%PROJECT_ROOT%"
pause
exit /b 0
