@echo off
chcp 65001 >nul 2>&1
title 🔨 打包 Tauri 桌面客户端 → 内网部署
setlocal enabledelayedexpansion

echo ==================================================
echo   🔨 构建 Tauri 桌面客户端（内网 LAN 版本）
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

:: ========== Step 1: 校验项目文件 ==========
echo [1/4] 📋 校验项目文件...
if not exist "client-chat-tauri\package.json" (
    echo ❌ 未找到 client-chat-tauri\package.json！
    pause
    exit /b 1
)
if not exist "client-chat-tauri\.env.lan" (
    echo ❌ 未找到 client-chat-tauri\.env.lan！
    echo.
    echo 💡 请先创建 .env.lan 并修改 VITE_GO_BASE_URL / VITE_GO_WS_URL 为实际服务器 IP
    pause
    exit /b 1
)
echo ✅ 所有源文件就绪
echo.

:: ========== Step 2: 预览并确认配置 ==========
echo [2/4] 📋 预览内网客户端配置（.env.lan）...
echo ----------------------------------------
type "client-chat-tauri\.env.lan"
echo ----------------------------------------
echo.

:: 提取 IP 用于后续提示
for /f "tokens=2 delims==" %%a in ('type "client-chat-tauri\.env.lan" ^| findstr /c:"VITE_GO_BASE_URL="') do set "SERVER_IP=%%a"
echo 🎯 目标服务器: %SERVER_IP%
echo.

:: ========== Step 3: 用内网配置构建 Tauri 客户端 ==========
echo [3/4] ⚡ 编译 Tauri 桌面客户端（内网版本）...

cd /d "%PROJECT_ROOT%\client-chat-tauri"

:: 备份原 .env.production
set "ENV_PROD=.env.production"
set "ENV_PROD_BAK=.env.production.bak"
if exist "%ENV_PROD%" (
    copy /y "%ENV_PROD%" "%ENV_PROD_BAK%" >nul
    echo   已备份 %ENV_PROD% → %ENV_PROD_BAK%
)

:: 用内网客户端配置替换
copy /y ".env.lan" "%ENV_PROD%" >nul
echo   已应用内网客户端环境变量
echo.

echo ==================================================
echo   Tauri 正在编译（首次约 5-15 分钟）...
echo   如卡住不动是正常的（Rust 正在编译依赖）
echo   目标服务器: %SERVER_IP%
echo ==================================================
echo.

call npm run tauri:build
set BUILD_RESULT=%errorlevel%

:: 恢复原 .env.production
if exist "%ENV_PROD_BAK%" (
    move /y "%ENV_PROD_BAK%" "%ENV_PROD%" >nul
    echo   已恢复原 .env.production
)

if %BUILD_RESULT% neq 0 (
    echo.
    echo ==================================================
    echo   ❌ Tauri 打包失败！错误码: %BUILD_RESULT%
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

:: ========== Step 4: 汇总产物到 bin/内网版本/ ==========
echo [4/4] 📋 汇总构建产物...

set "SRC_EXE=%PROJECT_ROOT%\client-chat-tauri\src-tauri\target\release\client-chat-tauri.exe"
set "SRC_BUNDLE=%PROJECT_ROOT%\client-chat-tauri\src-tauri\target\release\bundle"
set "OUT_DIR=%PROJECT_ROOT%\bin\内网版本"

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
echo   🏁  构建完成！内网 Tauri 桌面客户端
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
echo   📌 客户端会自动连接: %SERVER_IP%
echo.
echo   💡 如果部署到不同服务器，请:
echo       1. 修改 .env.lan 中的 IP 地址
echo       2. 重新运行本脚本
echo ==================================================
echo.

cd /d "%PROJECT_ROOT%"
pause
exit /b 0
