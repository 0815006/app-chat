package service

import (
	"context"
	"go-chat-server/global"
)

// OnlineService 在线状态查询服务
type OnlineService struct{}

// IsUserOnline 检查用户是否在线（供 service 层使用，避免循环依赖 im 包）
func (s *OnlineService) IsUserOnline(userID string) bool {
	if global.RDB != nil {
		ctx := context.Background()
		result, err := global.RDB.Get(ctx, "online:"+userID).Result()
		if err == nil && result == "1" {
			return true
		}
	}
	return false
}
