package service

import (
	"context"
	"fmt"

	"go-chat-server/global"
	"go-chat-server/model"

	"github.com/google/uuid"
)

// MessageStoreService 消息异步持久化服务
type MessageStoreService struct{}

// StoreMessage 将消息异步写入 MySQL
func (s *MessageStoreService) StoreMessage(ctx context.Context, senderID, receiverID, content, msgType string) (*model.Message, error) {
	msg := model.Message{
		ID:         uuid.New().String(),
		SenderID:   senderID,
		ReceiverID: receiverID,
		Content:    content,
		MsgType:    msgType,
		IsRead:     false,
	}

	if err := global.DB.WithContext(ctx).Create(&msg).Error; err != nil {
		return nil, fmt.Errorf("消息持久化失败: %w", err)
	}

	return &msg, nil
}

// MarkAsRead 将消息标记为已读
func (s *MessageStoreService) MarkAsRead(ctx context.Context, messageID string) error {
	return global.DB.WithContext(ctx).Model(&model.Message{}).
		Where("id = ?", messageID).
		Update("is_read", true).Error
}

// GetHistory 获取两个用户之间的历史消息
func (s *MessageStoreService) GetHistory(ctx context.Context, userID1, userID2 string, limit, offset int) ([]model.Message, error) {
	var messages []model.Message
	err := global.DB.WithContext(ctx).
		Where("(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
			userID1, userID2, userID2, userID1).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Preload("Sender").
		Find(&messages).Error
	if err != nil {
		return nil, fmt.Errorf("查询历史消息失败: %w", err)
	}
	return messages, nil
}
