package service

import (
	"context"
	"fmt"
	"time"

	"go-chat-server/global"
	"go-chat-server/model"

	"github.com/google/uuid"
)

// MessageStoreService 消息持久化服务
type MessageStoreService struct{}

// StoreMessage 将消息异步写入 MySQL
func (s *MessageStoreService) StoreMessage(ctx context.Context, senderID, receiverID, groupID, content, msgType, fileName string, fileSize int64) (*model.Message, error) {
	msg := model.Message{
		ID:         uuid.New().String(),
		SenderID:   senderID,
		ReceiverID: receiverID,
		GroupID:    groupID,
		Content:    content,
		MsgType:    msgType,
		FileName:   fileName,
		FileSize:   fileSize,
		IsRead:     false,
		IsRevoked:  false,
	}

	if err := global.DB.WithContext(ctx).Create(&msg).Error; err != nil {
		return nil, fmt.Errorf("消息持久化失败: %w", err)
	}

	return &msg, nil
}

// MarkAsRead 将单条消息标记为已读
func (s *MessageStoreService) MarkAsRead(ctx context.Context, messageID string) error {
	return global.DB.WithContext(ctx).Model(&model.Message{}).
		Where("id = ?", messageID).
		Update("is_read", true).Error
}

// BatchMarkAsRead 批量标记消息为已读
func (s *MessageStoreService) BatchMarkAsRead(ctx context.Context, messageIDs []string) error {
	if len(messageIDs) == 0 {
		return nil
	}
	return global.DB.WithContext(ctx).Model(&model.Message{}).
		Where("id IN ?", messageIDs).
		Update("is_read", true).Error
}

// RevokeMessage 撤回消息
func (s *MessageStoreService) RevokeMessage(ctx context.Context, messageID, senderID string) (*model.Message, error) {
	var msg model.Message
	if err := global.DB.WithContext(ctx).Where("id = ? AND sender_id = ?", messageID, senderID).First(&msg).Error; err != nil {
		return nil, fmt.Errorf("消息不存在或无权操作: %w", err)
	}

	// 撤回：设置 is_revoked=true，替换 content 为提示
	if err := global.DB.WithContext(ctx).Model(&msg).Updates(map[string]interface{}{
		"is_revoked": true,
		"content":    "[消息已被撤回]",
		"msg_type":   "text",
		"file_name":  "",
		"file_size":  0,
	}).Error; err != nil {
		return nil, fmt.Errorf("撤回消息失败: %w", err)
	}

	msg.IsRevoked = true
	return &msg, nil
}

// GetHistory 获取两个用户之间的历史消息（游标分页，DESC）
func (s *MessageStoreService) GetHistory(ctx context.Context, senderID, receiverID, before string, limit int) ([]model.Message, bool, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}

	query := global.DB.WithContext(ctx).
		Where(
			"(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
			senderID, receiverID, receiverID, senderID,
		).
		Order("created_at DESC").
		Limit(limit + 1) // 多取一条判断 has_more

	if before != "" {
		beforeTime, err := time.Parse(time.RFC3339, before)
		if err == nil {
			query = query.Where("created_at < ?", beforeTime)
		}
	}

	var messages []model.Message
	if err := query.Find(&messages).Error; err != nil {
		return nil, false, fmt.Errorf("查询历史消息失败: %w", err)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	return messages, hasMore, nil
}

// GetGroupHistory 获取群聊历史消息（游标分页）
func (s *MessageStoreService) GetGroupHistory(ctx context.Context, groupID, before string, limit int) ([]model.Message, bool, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}

	query := global.DB.WithContext(ctx).
		Where("group_id = ?", groupID).
		Order("created_at DESC").
		Limit(limit + 1)

	if before != "" {
		beforeTime, err := time.Parse(time.RFC3339, before)
		if err == nil {
			query = query.Where("created_at < ?", beforeTime)
		}
	}

	var messages []model.Message
	if err := query.Find(&messages).Error; err != nil {
		return nil, false, fmt.Errorf("查询群历史消息失败: %w", err)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	return messages, hasMore, nil
}

// GetLastMessage 获取两个用户之间的最后一条消息
func (s *MessageStoreService) GetLastMessage(ctx context.Context, userID1, userID2 string) *model.Message {
	var msg model.Message
	err := global.DB.WithContext(ctx).
		Where(
			"(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
			userID1, userID2, userID2, userID1,
		).
		Order("created_at DESC").
		First(&msg).Error
	if err != nil {
		return nil
	}
	return &msg
}

// GetGroupLastMessage 获取群组最后一条消息
func (s *MessageStoreService) GetGroupLastMessage(ctx context.Context, groupID string) *model.Message {
	var msg model.Message
	err := global.DB.WithContext(ctx).
		Where("group_id = ?", groupID).
		Order("created_at DESC").
		First(&msg).Error
	if err != nil {
		return nil
	}
	return &msg
}

// GetUnreadCount 获取两个用户之间的未读消息数
func (s *MessageStoreService) GetUnreadCount(ctx context.Context, senderID, receiverID string) int {
	var count int64
	global.DB.WithContext(ctx).Model(&model.Message{}).
		Where("sender_id = ? AND receiver_id = ? AND is_read = false AND is_revoked = false",
			senderID, receiverID).
		Count(&count)
	return int(count)
}

// GetGroupUnreadCount 获取群组未读消息数
func (s *MessageStoreService) GetGroupUnreadCount(ctx context.Context, groupID, userID string) int {
	var count int64
	global.DB.WithContext(ctx).Model(&model.Message{}).
		Where("group_id = ? AND sender_id != ? AND is_read = false AND is_revoked = false",
			groupID, userID).
		Count(&count)
	return int(count)
}

// MarkGroupMessagesRead 批量标记群消息为已读
func (s *MessageStoreService) MarkGroupMessagesRead(ctx context.Context, groupID string, messageIDs []string) error {
	if len(messageIDs) == 0 {
		return nil
	}
	return global.DB.WithContext(ctx).Model(&model.Message{}).
		Where("group_id = ? AND id IN ?", groupID, messageIDs).
		Update("is_read", true).Error
}
