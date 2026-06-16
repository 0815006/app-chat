package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"go-chat-server/config"
	"go-chat-server/initialize"
	"go-chat-server/middleware"

	"github.com/gin-gonic/gin"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

func main() {
	// 1. 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	log.Printf("配置加载成功，服务器端口: %d", cfg.Server.Port)

	// 2. 注入 JWT 配置到中间件包
	middleware.SetJWTConfig(&middleware.JWTConfig{
		Secret:      cfg.JWT.Secret,
		ExpireHours: cfg.JWT.ExpireHours,
	})

	// 3. 初始化 MySQL
	if err := initialize.InitDB(cfg); err != nil {
		log.Fatalf("MySQL 初始化失败: %v", err)
	}
	log.Println("MySQL 连接成功，AutoMigrate 完成")

	// 4. 初始化 Redis
	if err := initialize.InitRedis(cfg); err != nil {
		log.Fatalf("Redis 初始化失败: %v", err)
	}
	log.Println("Redis 连接成功")

	// 5. 设置路由
	router := initialize.InitRouter(cfg)

	// 6. SPA fallback：内嵌前端静态文件（Web 版本一站式部署）
	registerSPAFallback(router)

	// 7. 启动 HTTP 服务
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("🚀 go-chat-server 启动成功，监听地址: %s", addr)
	log.Printf("   API 基路径: http://127.0.0.1%s/api", addr)
	log.Printf("   WebSocket:  ws://127.0.0.1%s/ws", addr)

	// 检查是否内嵌了前端
	if _, err := fs.Sub(frontendFS, "frontend/dist"); err == nil {
		log.Printf("   🌐 Web 前端: http://127.0.0.1%s/", addr)
	}

	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}

// registerSPAFallback 为单页应用 (SPA) 注册 fallback 路由。
// 仅当前端文件已内嵌时生效；否则无操作。
func registerSPAFallback(router *gin.Engine) {
	subFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		// 没有嵌入前端文件（纯 Tauri 桌面端构建），跳过
		return
	}

	// 快速校验：至少 index.html 存在
	if _, err := subFS.Open("index.html"); err != nil {
		return
	}

	handler := spaFileServer(subFS)
	router.NoRoute(handler)
}

// spaFileServer 返回一个将所有 404 回退到 index.html 的 SPA 静态文件服务器。
func spaFileServer(fsys fs.FS) gin.HandlerFunc {
	fileServer := http.FileServer(http.FS(fsys))
	return func(c *gin.Context) {
		// 尝试直接提供请求的文件
		path := strings.TrimPrefix(c.Request.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if f, err := fsys.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		// 文件不存在 → SPA 回退：返回 index.html（Vue Router history mode）
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	}
}
