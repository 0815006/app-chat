# =================================================================
#        🌐 部署 Web SPA → 腾讯云（PowerShell 版）
#        由 deploy-web-tencent.bat 改写而来，功能完全一致
# =================================================================
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "🌐 部署 Web SPA → 腾讯云"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  🌐 部署 Web 前端 → 腾讯云 HTTPS" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# ─── 腾讯云服务器参数（按需修改）─────────────────────────────────
$SERVER_IP          = "129.211.9.238"
$DOMAIN             = "realapex.site"
$SERVER_USER        = "root"
$REMOTE_WEB_DIR     = "/var/www/app-chat/dist"
$REMOTE_NGINX_CONF  = "/etc/nginx/conf.d/app-chat.conf"
# ─────────────────────────────────────────────────────────────────

# 切到项目根目录
$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
Push-Location $ProjectRoot

if (-not $?) {
    Write-Host "❌ 无法进入项目根目录！" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "📁 项目根目录: $((Get-Location).Path)"
Write-Host ""

# ========== Step 1: 校验项目文件 ==========
Write-Host "[1/4] 📋 校验项目文件..." -ForegroundColor Yellow

if (-not (Test-Path "client-chat-tauri\package.json")) {
    Write-Host "❌ 未找到 client-chat-tauri\package.json！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
if (-not (Test-Path "client-chat-tauri\.env.production")) {
    Write-Host "❌ 未找到 client-chat-tauri\.env.production！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
if (-not (Test-Path "deploy\nginx-chat.conf")) {
    Write-Host "❌ 未找到 deploy\nginx-chat.conf！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "✅ 所有源文件就绪" -ForegroundColor Green
Write-Host ""

# ========== Step 2: 构建 Vue SPA ==========
Write-Host "[2/4] ⚡ 构建 Vue 前端（读取 .env.production）..." -ForegroundColor Yellow

Push-Location "$ProjectRoot\client-chat-tauri"

Write-Host "  后端地址: 由 .env.production 中的 VITE_GO_BASE_URL 指定"
Write-Host ""
Write-Host "=================================================="
Write-Host "  Vite 正在编译..."
Write-Host "=================================================="
Write-Host ""

& npm run build
$BuildResult = $LASTEXITCODE

if ($BuildResult -ne 0) {
    Write-Host ""
    Write-Host "❌ 前端构建失败！" -ForegroundColor Red
    Pop-Location
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host ""
Write-Host "✅ 前端构建完成" -ForegroundColor Green
Write-Host ""
Pop-Location

# ========== Step 3: 上传到腾讯云服务器 ==========
Write-Host "[3/4] 🚀 上传前端产物到腾讯云..." -ForegroundColor Yellow

$DistDir = "$ProjectRoot\client-chat-tauri\dist"

if (-not (Test-Path $DistDir)) {
    Write-Host "❌ 未找到构建产物 $DistDir" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}

# 3.1 远程清理旧文件 + 创建目录
Write-Host "  远程清理旧 Web 文件 + 创建目录..."
ssh "${SERVER_USER}@${SERVER_IP}" "rm -rf ${REMOTE_WEB_DIR}; mkdir -p ${REMOTE_WEB_DIR}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SSH 连接失败！请检查免密登录配置或服务器 IP。" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}

# 3.2 上传 dist 目录内所有文件
Write-Host "  上传 dist/* → ${REMOTE_WEB_DIR}/"
scp -r "$DistDir\*" "${SERVER_USER}@${SERVER_IP}:${REMOTE_WEB_DIR}/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 前端文件上传失败！请检查 SSH 连接和磁盘空间。" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "✅ 前端文件上传完成" -ForegroundColor Green
Write-Host ""

# 3.3 上传 Nginx 配置
Write-Host "  上传 Nginx 配置 → ${REMOTE_NGINX_CONF}"
scp "$ProjectRoot\deploy\nginx-chat.conf" "${SERVER_USER}@${SERVER_IP}:${REMOTE_NGINX_CONF}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Nginx 配置上传失败！" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host ""

# 3.4 远程重载 Nginx
Write-Host "  远程校验并重载 Nginx..."
ssh "${SERVER_USER}@${SERVER_IP}" "nginx -t && nginx -s reload"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Nginx 重载失败！请检查 nginx-chat.conf 语法。" -ForegroundColor Red
    Pop-Location
    Read-Host "按回车键退出..."
    exit 1
}
Write-Host "✅ Nginx 已重载" -ForegroundColor Green
Write-Host ""

# ========== Step 4: 完成 ==========
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  🏁  Web 前端部署完成！" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  📌 访问地址:"
Write-Host "     https://${DOMAIN}:8084/"
Write-Host ""
Write-Host "  📌 部署架构:"
Write-Host "     浏览器 → HTTPS :8084 (Nginx)"
Write-Host "       ├── /               → 静态文件 /var/www/app-chat/dist/"
Write-Host "       ├── /api/*          → 反代 Go :8094"
Write-Host "       ├── /ws             → WebSocket Go :8094"
Write-Host "       └── /uploads/*      → 反代 Go :8094"
Write-Host ""
Write-Host "  📌 后续更新前端:"
Write-Host "     仅需重新运行本脚本，无需重启 Go 后端或 Nginx"
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

Pop-Location
Read-Host "按回车键退出..."
exit 0
