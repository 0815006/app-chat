package im

import (
	"github.com/gin-gonic/gin"
)

// Handler WebSocket 建立/断开/消息处理的 HTTP 入口
type Handler struct {
	mgr *Manager
}

// NewHandler 创建 Handler
func NewHandler() *Handler {
	return &Handler{mgr: GetManager()}
}

// Upgrade 处理 WebSocket 升级请求
func (h *Handler) Upgrade(c *gin.Context) {
	h.mgr.HandleWebSocketGin(c)
}
