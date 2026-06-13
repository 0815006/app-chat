package service

import (
	"context"
	"fmt"
	"time"

	"go-chat-server/global"
	"go-chat-server/model"

	"github.com/google/uuid"
)

// FriendshipService 好友关系业务逻辑
type FriendshipService struct {
	userSvc     *UserService
	msgStoreSvc *MessageStoreService
	onlineSvc   *OnlineService
}

// AddFriend 添加好友（双向写入，直接 accepted）
func (s *FriendshipService) AddFriend(ctx context.Context, userID, friendID string) (*model.FriendResponse, error) {
	// 检查目标用户是否存在
	_, err := s.getUserSvc().GetByID(ctx, friendID)
	if err != nil {
		return nil, fmt.Errorf("目标用户不存在: %w", err)
	}

	// 检查是否已有关系记录
	var exist model.Friendship
	err = global.DB.WithContext(ctx).
		Where("user_id = ? AND friend_id = ?", userID, friendID).
		First(&exist).Error
	if err == nil {
		// 已存在，直接返回聚合数据
		return s.buildFriendResponse(ctx, userID, exist)
	}

	// 双向写入 (A→B, B→A)，直接 accepted
	f1 := model.Friendship{
		ID:       uuid.New().String(),
		UserID:   userID,
		FriendID: friendID,
		Status:   "accepted",
	}
	f2 := model.Friendship{
		ID:       uuid.New().String(),
		UserID:   friendID,
		FriendID: userID,
		Status:   "accepted",
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
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	return s.buildFriendResponse(ctx, userID, f1)
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

// DeleteFriend 删除好友（双向删除）
func (s *FriendshipService) DeleteFriend(ctx context.Context, userID, friendID string) error {
	tx := global.DB.WithContext(ctx).Begin()

	// 删除 A→B
	if err := tx.Where("user_id = ? AND friend_id = ?", userID, friendID).Delete(&model.Friendship{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除好友关系失败: %w", err)
	}
	// 删除 B→A
	if err := tx.Where("user_id = ? AND friend_id = ?", friendID, userID).Delete(&model.Friendship{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除好友关系失败: %w", err)
	}

	return tx.Commit().Error
}

// ListFriends 获取好友列表（聚合响应）
func (s *FriendshipService) ListFriends(ctx context.Context, userID string) ([]model.FriendResponse, error) {
	var friendships []model.Friendship
	err := global.DB.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, "accepted").
		Preload("Friend").
		Find(&friendships).Error
	if err != nil {
		return nil, fmt.Errorf("查询好友列表失败: %w", err)
	}

	responses := make([]model.FriendResponse, 0, len(friendships))
	for _, f := range friendships {
		resp, err := s.buildFriendResponse(ctx, userID, f)
		if err != nil {
			continue
		}
		responses = append(responses, *resp)
	}

	return responses, nil
}

// buildFriendResponse 构建聚合好友响应
func (s *FriendshipService) buildFriendResponse(ctx context.Context, currentUserID string, f model.Friendship) (*model.FriendResponse, error) {
	resp := &model.FriendResponse{
		ID:       f.ID,
		FriendID: f.FriendID,
	}

	if f.Friend != nil {
		resp.Name = f.Friend.Nickname
		resp.EmployeeID = f.Friend.EmployeeID
		resp.AvatarURL = f.Friend.AvatarURL
	} else {
		// Preload 未加载成功，手动查询
		user, err := s.getUserSvc().GetByID(ctx, f.FriendID)
		if err != nil {
			return nil, err
		}
		resp.Name = user.Nickname
		resp.EmployeeID = user.EmployeeID
		resp.AvatarURL = user.AvatarURL
	}

	// 查询在线状态（通过 OnlineService，避免循环依赖 im 包）
	resp.Online = s.getOnlineSvc().IsUserOnline(f.FriendID)

	// 查询最后一条消息
	lastMsg := s.getMsgStoreSvc().GetLastMessage(ctx, currentUserID, f.FriendID)
	if lastMsg != nil {
		content := lastMsg.Content
		resp.LastMessage = &content
		resp.LastMessageType = &lastMsg.MsgType
		at := lastMsg.CreatedAt.Format(time.RFC3339)
		resp.LastMessageAt = &at
	}

	// 查询未读计数
	resp.UnreadCount = s.getMsgStoreSvc().GetUnreadCount(ctx, f.FriendID, currentUserID)

	return resp, nil
}

func (s *FriendshipService) getUserSvc() *UserService {
	if s.userSvc == nil {
		s.userSvc = &UserService{}
	}
	return s.userSvc
}

func (s *FriendshipService) getMsgStoreSvc() *MessageStoreService {
	if s.msgStoreSvc == nil {
		s.msgStoreSvc = &MessageStoreService{}
	}
	return s.msgStoreSvc
}

func (s *FriendshipService) getOnlineSvc() *OnlineService {
	if s.onlineSvc == nil {
		s.onlineSvc = &OnlineService{}
	}
	return s.onlineSvc
}
