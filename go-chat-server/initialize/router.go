package initialize

import (
	"go-chat-server/api"
	"go-chat-server/config"
	"go-chat-server/im"
	"go-chat-server/middleware"

	"github.com/gin-gonic/gin"
)

// InitRouter 统一注册 HTTP 与 WebSocket 路由
func InitRouter(cfg *config.Config) *gin.Engine {
	// 设置 Gin 运行模式
	gin.SetMode(cfg.Server.Mode)
	r := gin.Default()

	// 静态文件 / 健康检查
	r.GET("/api/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"code": 200, "message": "pong"})
	})

	// 公开 API（无需鉴权）
	pub := r.Group("/api")
	{
		pub.POST("/register", api.Register)
		pub.POST("/login", api.Login)
	}

	// 需要 JWT 鉴权的 API
	auth := r.Group("/api")
	auth.Use(middleware.JWTAuth())
	{
		auth.GET("/me", api.GetMe)
		auth.GET("/friends", api.ListFriends)
		auth.POST("/friends", api.AddFriend)
		auth.PUT("/friends/:id", api.UpdateFriendStatus)
		auth.GET("/history", api.GetHistory)
	}

	// WebSocket 路由
	r.GET("/ws", im.GetManager().HandleWebSocketGin)

	return r
}
