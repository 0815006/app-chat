# =================================================================
#        🚀 go-chat-server — 腾讯云一键全自动生产部署脚本
#        参照 deploy/nginx-aicode.conf 模式，HTTPS + Nginx 反代
# =================================================================
$Stage = "【腾讯云 Go 后端部署】"
Write-Host "$Stage 开始执行..." -ForegroundColor Cyan

# ─── 1. 配置你的腾讯云服务器参数（按需修改） ───────────────────────
$SERVER_IP   = "129.211.9.238"                    # 腾讯云公网 IP
$DOMAIN      = "realapex.site"                    # 已备案域名
$SERVER_USER = "root"
$REMOTE_DIR  = "/root/chat-server"                 # 服务端工作目录
$LOCAL_EXE   = "go-chat-server"                    # Linux 二进制文件名（无 .exe）
$SERVICE_NAME = "chat-server"                      # systemd 服务名
$INTERNAL_PORT = 8194                              # Go 内部 HTTP 端口（仅 127.0.0.1）
$NGINX_PORT    = 8094                              # Nginx SSL 对外端口

Write-Host "  目标: ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}" -ForegroundColor DarkGray
Write-Host "  架构: HTTPS :${NGINX_PORT} (Nginx) → HTTP 127.0.0.1:${INTERNAL_PORT} (Go)" -ForegroundColor DarkGray

# ─── 2. 本地交叉编译 → Linux amd64 二进制包 ───────────────────────
Write-Host "`n$Stage [1/6] 正在本地交叉编译 Linux 生产环境专用二进制包..." -ForegroundColor Yellow

Push-Location "$PSScriptRoot\..\go-chat-server"

$env:GOOS = "linux"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"                            # 纯静态编译，无 glibc 依赖
$env:GOPROXY = "https://goproxy.cn,https://proxy.golang.org,direct"  # 国内代理，防墙

$buildCmd = "go build -ldflags `"-s -w`" -o $LOCAL_EXE main.go"
Write-Host "  执行: $buildCmd" -ForegroundColor DarkGray
Invoke-Expression $buildCmd

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 本地交叉编译失败，请检查 Go 代码语法！" -ForegroundColor Red
    Pop-Location
    Exit 1
}

$fileSize = [math]::Round((Get-Item $LOCAL_EXE).Length / 1MB, 2)
Write-Host "[Success] Linux 编译完成 ($LOCAL_EXE, ${fileSize}MB)" -ForegroundColor Green

Pop-Location

# ─── 3. 自动化上传到腾讯云服务器 ─────────────────────────────────
Write-Host "`n$Stage [2/6] 正在通过 SCP 上传文件到腾讯云..." -ForegroundColor Yellow

# 3.0 先停服释放旧二进制文件（防止 SCP overwrite 被锁）
Write-Host "  停服释放旧文件: systemctl stop + rm" -ForegroundColor DarkGray
ssh "${SERVER_USER}@${SERVER_IP}" "systemctl stop chat-server 2>/dev/null; sleep 1; rm -f ${REMOTE_DIR}/${LOCAL_EXE}; mkdir -p ${REMOTE_DIR}/config ${REMOTE_DIR}/uploads"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SSH 连接失败！请检查免密登录配置或服务器 IP。" -ForegroundColor Red
    Exit 1
}

# 3.1 创建远程工作目录（已并入上一步）
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SSH 连接失败！请检查免密登录配置或服务器 IP。" -ForegroundColor Red
    Exit 1
}

# 3.2 上传 Linux 二进制包
Write-Host "  上传二进制: go-chat-server → ${REMOTE_DIR}/" -ForegroundColor DarkGray
scp "$PSScriptRoot\..\go-chat-server\$LOCAL_EXE" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 二进制上传失败！请检查 22 端口或磁盘空间。" -ForegroundColor Red
    Exit 1
}

# 3.3 上传生产环境配置文件（覆盖为 config.yaml）
Write-Host "  上传配置: config.prod.yaml → ${REMOTE_DIR}/config/config.yaml" -ForegroundColor DarkGray
scp "$PSScriptRoot\..\go-chat-server\config\config.prod.yaml" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/config/config.yaml"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 配置文件上传失败！" -ForegroundColor Red
    Exit 1
}

# 3.4 上传 systemd 服务单元文件
Write-Host "  上传 systemd 服务: chat-server.service → /etc/systemd/system/" -ForegroundColor DarkGray
scp "$PSScriptRoot\chat-server.service" "${SERVER_USER}@${SERVER_IP}:/etc/systemd/system/chat-server.service"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ systemd 服务文件上传失败！" -ForegroundColor Red
    Exit 1
}

# 3.5 上传 Nginx 配置
Write-Host "  上传 Nginx 配置: nginx-chat.conf → /etc/nginx/conf.d/app-chat.conf" -ForegroundColor DarkGray
scp "$PSScriptRoot\nginx-chat.conf" "${SERVER_USER}@${SERVER_IP}:/etc/nginx/conf.d/app-chat.conf"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Nginx 配置文件上传失败！" -ForegroundColor Red
    Exit 1
}

Write-Host "[Success] 全部文件已推送到远程目录: $REMOTE_DIR" -ForegroundColor Green

# ─── 4. 远程通电，激活生产环境 ────────────────────────────────────
Write-Host "`n$Stage [3/6] 正在远程连接腾讯云，执行服务注册与重启..." -ForegroundColor Yellow

# 通过 SSH 发送复合命令：赋权 → 刷新 daemon → 重启服务 → 重载 Nginx → 打印状态
# 注意：heredoc 在 Windows 上生成 CRLF，必须转为 LF 否则 Linux 上命令全部带 \r 失败
$remoteScript = (@"
echo '⚡ 正在赋权二进制文件...'
chmod +x ${REMOTE_DIR}/${LOCAL_EXE}
echo '⚡ 重载 systemd 守护进程...'
systemctl daemon-reload
echo '⚡ 重启 chat-server 服务...'
systemctl enable chat-server 2>/dev/null || true
systemctl restart chat-server
sleep 2
echo ''
echo '🔍 调取 Go 后端运行状态：'
systemctl status chat-server --no-pager -l
echo ''
echo '⚡ 校验 Nginx 配置并重载...'
nginx -t && nginx -s reload
echo ''
echo '🔍 Nginx 重载结果：'
echo '   HTTPS API:  https://${DOMAIN}:${NGINX_PORT}/api'
echo '   WSS:        wss://${DOMAIN}:${NGINX_PORT}/ws'
"@) -replace "`r`n", "`n"

ssh "${SERVER_USER}@${SERVER_IP}" $remoteScript

# ─── 5. 快速健康检查 ──────────────────────────────────────────────
Write-Host "`n$Stage [4/6] 快速健康检查..." -ForegroundColor Yellow
Start-Sleep -Seconds 1

# 5.1 先 SSH 进服务器内部 curl Go 本地端口（Go 只绑 127.0.0.1，公网 IP 打不进来）
Write-Host "  5.1 SSH 内自检 Go 内部 HTTP (curl 127.0.0.1:${INTERNAL_PORT})..." -ForegroundColor DarkGray
$internalCheck = ssh -o ConnectTimeout=5 "${SERVER_USER}@${SERVER_IP}" "curl -s --connect-timeout 3 --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:${INTERNAL_PORT}/api/ping"
if ($LASTEXITCODE -eq 0 -and $internalCheck -eq '200') {
    Write-Host "[Success] Go 内部 HTTP 存活: 127.0.0.1:${INTERNAL_PORT} → 200" -ForegroundColor Green
} else {
    Write-Host "⚠️  Go 内部 HTTP 检查未通过 (code=$internalCheck)，服务可能仍在启动中。" -ForegroundColor Yellow
}

# 5.2 再检查 Nginx HTTPS 反代（从本机直连公网入口，验证整条链路）
$nginxUrl = "https://${DOMAIN}:${NGINX_PORT}/api/ping"
try {
    $response = Invoke-WebRequest -Uri $nginxUrl -TimeoutSec 8 -UseBasicParsing -SkipCertificateCheck
    Write-Host "[Success] Nginx HTTPS 反代通过: $nginxUrl → $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "⚠️  HTTPS 检查未通过 ($nginxUrl)，请确认安全组已开放 ${NGINX_PORT} 端口。" -ForegroundColor Yellow
}

# ─── 6. 清理本地编译产物 ──────────────────────────────────────────
Write-Host "`n$Stage [5/6] 清理本地编译缓存..." -ForegroundColor Yellow
Remove-Item "$PSScriptRoot\..\go-chat-server\$LOCAL_EXE" -ErrorAction SilentlyContinue
Write-Host "[Success] 本地缓存已清理" -ForegroundColor Green

# ─── 完成 ─────────────────────────────────────────────────────────
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "🏁  全自动生产部署圆满完成！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   架构: 客户端 → HTTPS :${NGINX_PORT} (Nginx) → HTTP :${INTERNAL_PORT} (Go)"
Write-Host ""
Write-Host "   外部访问地址（HTTPS）："
Write-Host "     API:        https://${DOMAIN}:${NGINX_PORT}/api"
Write-Host "     WebSocket:  wss://${DOMAIN}:${NGINX_PORT}/ws"
Write-Host "     Ping:       https://${DOMAIN}:${NGINX_PORT}/api/ping"
Write-Host "     文件上传:   https://${DOMAIN}:${NGINX_PORT}/uploads/"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "按回车键退出..."
