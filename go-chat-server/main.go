package main

import (
	"fmt"
	"log"
	"net/http"

	"go-chat-server/config"
	"go-chat-server/initialize"
	"go-chat-server/middleware"
)

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

	// 6. 启动 HTTP 服务
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("🚀 go-chat-server 启动成功，监听地址: %s", addr)
	log.Printf("   API 基路径: http://127.0.0.1%s/api", addr)
	log.Printf("   WebSocket:  ws://127.0.0.1%s/ws", addr)

	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
