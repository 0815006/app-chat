package service

import (
	"context"
	"fmt"
	"time"

	"go-chat-server/global"
	"go-chat-server/model"

	"github.com/google/uuid"
)

// GroupService 群组业务逻辑
type GroupService struct {
	userSvc     *UserService
	msgStoreSvc *MessageStoreService
	onlineSvc   *OnlineService
}

// CreateGroup 创建群组
func (s *GroupService) CreateGroup(ctx context.Context, ownerID, name string, memberIDs []string) (*model.Group, error) {
	// 去重：确保群主在成员列表中
	memberSet := make(map[string]bool)
	memberSet[ownerID] = true
	for _, id := range memberIDs {
		memberSet[id] = true
	}

	group := model.Group{
		ID:      uuid.New().String(),
		Name:    name,
		OwnerID: ownerID,
	}

	tx := global.DB.WithContext(ctx).Begin()

	if err := tx.Create(&group).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("创建群组失败: %w", err)
	}

	// 添加群主和成员
	for userID := range memberSet {
		role := "member"
		if userID == ownerID {
			role = "owner"
		}
		gm := model.GroupMember{
			ID:      uuid.New().String(),
			GroupID: group.ID,
			UserID:  userID,
			Role:    role,
		}
		if err := tx.Create(&gm).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("添加群成员失败: %w", err)
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	return &group, nil
}

// GetGroupByID 根据 ID 获取群组
func (s *GroupService) GetGroupByID(ctx context.Context, groupID string) (*model.Group, error) {
	var group model.Group
	if err := global.DB.WithContext(ctx).Where("id = ?", groupID).First(&group).Error; err != nil {
		return nil, fmt.Errorf("群组不存在: %w", err)
	}
	return &group, nil
}

// GetMemberUserIDs 获取群组所有成员的 userID 列表
func (s *GroupService) GetMemberUserIDs(ctx context.Context, groupID string) ([]string, error) {
	var members []model.GroupMember
	if err := global.DB.WithContext(ctx).
		Where("group_id = ?", groupID).
		Find(&members).Error; err != nil {
		return nil, err
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	return ids, nil
}

// GetMembers 获取群成员列表（含用户资料）
func (s *GroupService) GetMembers(ctx context.Context, groupID string) ([]model.GroupMember, error) {
	var members []model.GroupMember
	if err := global.DB.WithContext(ctx).
		Where("group_id = ?", groupID).
		Preload("User").
		Order("joined_at ASC").
		Find(&members).Error; err != nil {
		return nil, fmt.Errorf("查询群成员失败: %w", err)
	}
	return members, nil
}

// ListUserGroups 获取用户所在的所有群组（聚合响应）
func (s *GroupService) ListUserGroups(ctx context.Context, userID string) ([]model.GroupResponse, error) {
	// 1. 查询用户的所有群成员记录
	var memberships []model.GroupMember
	if err := global.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&memberships).Error; err != nil {
		return nil, fmt.Errorf("查询群成员记录失败: %w", err)
	}

	if len(memberships) == 0 {
		return []model.GroupResponse{}, nil
	}

	// 2. 聚合群组 ID
	groupIDs := make([]string, len(memberships))
	for i, m := range memberships {
		groupIDs[i] = m.GroupID
	}

	// 3. 查询群组详情
	var groups []model.Group
	if err := global.DB.WithContext(ctx).
		Where("id IN ?", groupIDs).
		Find(&groups).Error; err != nil {
		return nil, fmt.Errorf("查询群组详情失败: %w", err)
	}

	// 4. 构建聚合响应
	responses := make([]model.GroupResponse, 0, len(groups))
	for _, g := range groups {
		resp := s.buildGroupResponse(ctx, &g, userID)
		responses = append(responses, *resp)
	}

	return responses, nil
}

// AddMember 拉人进群
func (s *GroupService) AddMember(ctx context.Context, groupID, userID, operatorID string) error {
	// 检查群组是否存在
	if _, err := s.GetGroupByID(ctx, groupID); err != nil {
		return err
	}

	// 检查用户是否存在
	if _, err := s.getUserSvc().GetByID(ctx, userID); err != nil {
		return fmt.Errorf("用户不存在: %w", err)
	}

	// 检查是否已在群中
	var exist model.GroupMember
	err := global.DB.WithContext(ctx).
		Where("group_id = ? AND user_id = ?", groupID, userID).
		First(&exist).Error
	if err == nil {
		return fmt.Errorf("用户已在群中")
	}

	gm := model.GroupMember{
		ID:      uuid.New().String(),
		GroupID: groupID,
		UserID:  userID,
		Role:    "member",
	}

	return global.DB.WithContext(ctx).Create(&gm).Error
}

// RemoveMember 踢人/退群
func (s *GroupService) RemoveMember(ctx context.Context, groupID, userID string) error {
	result := global.DB.WithContext(ctx).
		Where("group_id = ? AND user_id = ?", groupID, userID).
		Delete(&model.GroupMember{})
	if result.Error != nil {
		return fmt.Errorf("移除群成员失败: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("该用户不在群中")
	}
	return nil
}

// UpdateGroupName 修改群名
func (s *GroupService) UpdateGroupName(ctx context.Context, groupID, name string) error {
	return global.DB.WithContext(ctx).Model(&model.Group{}).
		Where("id = ?", groupID).
		Update("name", name).Error
}

// DissolveGroup 解散群组（仅群主）
func (s *GroupService) DissolveGroup(ctx context.Context, groupID, ownerID string) error {
	tx := global.DB.WithContext(ctx).Begin()

	// 验证群主身份
	var group model.Group
	if err := tx.Where("id = ? AND owner_id = ?", groupID, ownerID).First(&group).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("无权解散群组: %w", err)
	}

	// 删除群成员
	if err := tx.Where("group_id = ?", groupID).Delete(&model.GroupMember{}).Error; err != nil {
		tx.Rollback()
		return err
	}
	// 删除群组
	if err := tx.Delete(&group).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// IsGroupMember 检查用户是否为群成员
func (s *GroupService) IsGroupMember(ctx context.Context, groupID, userID string) bool {
	var count int64
	global.DB.WithContext(ctx).Model(&model.GroupMember{}).
		Where("group_id = ? AND user_id = ?", groupID, userID).
		Count(&count)
	return count > 0
}

// buildGroupResponse 构建群组聚合响应
func (s *GroupService) buildGroupResponse(ctx context.Context, g *model.Group, userID string) *model.GroupResponse {
	resp := &model.GroupResponse{
		ID:        g.ID,
		Name:      g.Name,
		AvatarURL: g.AvatarURL,
		OwnerID:   g.OwnerID,
		CreatedAt: g.CreatedAt.Format(time.RFC3339),
	}

	// 成员数量
	var count int64
	global.DB.WithContext(ctx).Model(&model.GroupMember{}).
		Where("group_id = ?", g.ID).Count(&count)
	resp.MemberCount = int(count)

	// 最后一条消息
	lastMsg := s.getMsgStoreSvc().GetGroupLastMessage(ctx, g.ID)
	if lastMsg != nil {
		content := lastMsg.Content
		resp.LastMessage = &content
		resp.LastMessageType = &lastMsg.MsgType
		at := lastMsg.CreatedAt.Format(time.RFC3339)
		resp.LastMessageAt = &at
	}

	// 未读计数
	resp.UnreadCount = s.getMsgStoreSvc().GetGroupUnreadCount(ctx, g.ID, userID)

	return resp
}

func (s *GroupService) getUserSvc() *UserService {
	if s.userSvc == nil {
		s.userSvc = &UserService{}
	}
	return s.userSvc
}

func (s *GroupService) getMsgStoreSvc() *MessageStoreService {
	if s.msgStoreSvc == nil {
		s.msgStoreSvc = &MessageStoreService{}
	}
	return s.msgStoreSvc
}

func (s *GroupService) getOnlineSvc() *OnlineService {
	if s.onlineSvc == nil {
		s.onlineSvc = &OnlineService{}
	}
	return s.onlineSvc
}
