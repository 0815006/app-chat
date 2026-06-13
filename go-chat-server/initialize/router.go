package initialize

import (
	"time"

	"go-chat-server/api"
	"go-chat-server/config"
	"go-chat-server/im"
	"go-chat-server/middleware"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// InitRouter 统一注册 HTTP 与 WebSocket 路由
func InitRouter(cfg *config.Config) *gin.Engine {
	// 设置 Gin 运行模式
	gin.SetMode(cfg.Server.Mode)
	r := gin.Default()

	// CORS 跨域中间件 — 本地桌面应用无 CSRF 风险，放行所有 origin
	// 注：生产部署时可按需收紧为特定域名
	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			return true
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// 静态文件服务（上传文件公开访问）
	uploadDir := cfg.Upload.Dir
	if uploadDir == "" {
		uploadDir = "./uploads"
	}
	r.Static("/uploads", uploadDir)

	// 健康检查
	r.GET("/api/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"code": 200, "message": "pong"})
	})

	// ========== 公开 API（无需鉴权） ==========
	pub := r.Group("/api")
	{
		pub.POST("/register", api.Register)
		pub.POST("/login", api.Login)
	}

	// ========== 需要 JWT 鉴权的 API ==========
	auth := r.Group("/api")
	auth.Use(middleware.JWTAuth())
	{
		// -- 会话 --
		auth.GET("/session", api.RecoverSession)

		// -- 个人资料 --
		auth.GET("/me", api.GetMe)
		auth.PUT("/me", api.UpdateMe)
		auth.POST("/me/avatar", api.UploadAvatar)
		auth.DELETE("/me/avatar", api.DeleteAvatar)

		// -- 好友管理 --
		auth.GET("/friends", api.ListFriends)
		auth.POST("/friends", api.AddFriend)
		auth.PUT("/friends/:id", api.UpdateFriendStatus)
		auth.DELETE("/friends/:friendId", api.DeleteFriend)

		// -- 私聊历史 --
		auth.GET("/history", api.GetHistory)

		// -- 消息（HTTP 退化路径） --
		auth.POST("/messages", api.SendMessageHTTP)
		auth.POST("/messages/read", api.BatchMarkRead)
		auth.POST("/messages/:messageId/revoke", api.RevokeMessage)

		// -- 文件上传 --
		auth.POST("/upload", api.UploadFile)

		// -- 用户搜索与列表 --
		auth.GET("/users/search", api.SearchUsers)
		auth.GET("/users", api.ListUsers)

		// -- 在线状态 --
		auth.PUT("/users/online", api.MarkOnline)
		auth.PUT("/users/offline", api.MarkOffline)

		// -- 群组管理 --
		auth.POST("/groups", api.CreateGroup)
		auth.GET("/groups", api.ListGroups)
		auth.GET("/groups/:groupId/history", api.GetGroupHistory)
		auth.GET("/groups/:groupId/members", api.GetGroupMembers)
		auth.POST("/groups/:groupId/members", api.AddGroupMember)
		auth.PUT("/groups/:groupId/name", api.UpdateGroupName)
		auth.DELETE("/groups/:groupId/members/:userId", api.RemoveGroupMember)
		auth.DELETE("/groups/:groupId", api.DissolveGroup)
		auth.POST("/groups/:groupId/messages/read", api.MarkGroupMessagesRead)
	}

	// ========== WebSocket 路由 ==========
	r.GET("/ws", im.GetManager().HandleWebSocketGin)

	return r
}
