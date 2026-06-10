package service

import (
	"context"
	"fmt"

	"go-chat-server/global"
	"go-chat-server/model"

	"github.com/google/uuid"
)

// FriendshipService 好友关系业务逻辑
type FriendshipService struct{}

// AddFriend 添加好友（双向写入）
func (s *FriendshipService) AddFriend(ctx context.Context, userID, friendID string) (*model.Friendship, error) {
	// 检查目标用户是否存在
	var friend model.User
	if err := global.DB.WithContext(ctx).Where("id = ?", friendID).First(&friend).Error; err != nil {
		return nil, fmt.Errorf("目标用户不存在: %w", err)
	}

	// 检查是否已有关系记录
	var exist model.Friendship
	err := global.DB.WithContext(ctx).
		Where("user_id = ? AND friend_id = ?", userID, friendID).
		First(&exist).Error
	if err == nil {
		return &exist, nil
	}

	// 双向写入 (A→B, B→A)
	f1 := model.Friendship{
		ID:       uuid.New().String(),
		UserID:   userID,
		FriendID: friendID,
		Status:   "pending",
	}
	f2 := model.Friendship{
		ID:       uuid.New().String(),
		UserID:   friendID,
		FriendID: userID,
		Status:   "pending",
	}

	tx := global.DB.WithContext(ctx).Begin()
	if err := tx.Create(&f1).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("创建好友关系失败: %w", err)
	}
	if err := tx.Create(&f2).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("创建好友关系失败: %w", err)
	}
	return &f1, tx.Commit().Error
}

// AcceptFriend 同意好友申请（双向更新为 accepted）
func (s *FriendshipService) AcceptFriend(ctx context.Context, friendshipID, userID string) error {
	tx := global.DB.WithContext(ctx).Begin()

	var f model.Friendship
	if err := tx.Where("id = ? AND friend_id = ?", friendshipID, userID).First(&f).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("好友申请不存在: %w", err)
	}

	if err := tx.Model(&f).Update("status", "accepted").Error; err != nil {
		tx.Rollback()
		return err
	}

	// 更新对方的记录
	if err := tx.Model(&model.Friendship{}).
		Where("user_id = ? AND friend_id = ?", f.FriendID, f.UserID).
		Update("status", "accepted").Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// ListFriends 获取好友列表（已接受的好友）
func (s *FriendshipService) ListFriends(ctx context.Context, userID string) ([]model.Friendship, error) {
	var friends []model.Friendship
	err := global.DB.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, "accepted").
		Preload("Friend").
		Find(&friends).Error
	if err != nil {
		return nil, fmt.Errorf("查询好友列表失败: %w", err)
	}
	return friends, nil
}
