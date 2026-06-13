package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"go-chat-server/im"
	"go-chat-server/service"

	"github.com/gin-gonic/gin"
)

var groupSvc = &service.GroupService{}
var groupMsgSvc = &service.MessageStoreService{}

// CreateGroup 创建群组
func CreateGroup(c *gin.Context) {
	userID := mustGetUserID(c)

	var req struct {
		Name      string   `json:"name"`
		MemberIDs []string `json:"member_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请求参数错误"})
		return
	}
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "群名称不能为空"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	group, err := groupSvc.CreateGroup(ctx, userID, req.Name, req.MemberIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 广播群成员加入通知（建群时）
	for _, memberID := range req.MemberIDs {
		im.GetManager().BroadcastGroupMemberJoin(group.ID, memberID)
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "群组创建成功", "data": group})
}

// ListGroups 获取群组列表（聚合响应）
func ListGroups(c *gin.Context) {
	userID := mustGetUserID(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	groups, err := groupSvc.ListUserGroups(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": groups})
}

// GetGroupHistory 获取群聊历史消息（游标分页）
func GetGroupHistory(c *gin.Context) {
	groupID := c.Param("groupId")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少群组ID"})
		return
	}

	limitStr := c.DefaultQuery("limit", "20")
	before := c.Query("before")

	limit := 20
	if _, err := fmt.Sscanf(limitStr, "%d", &limit); err != nil || limit <= 0 || limit > 200 {
		limit = 20
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	messages, hasMore, err := groupMsgSvc.GetGroupHistory(ctx, groupID, before, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	successWithHasMore(c, messages, hasMore)
}

// GetGroupMembers 获取群成员列表
func GetGroupMembers(c *gin.Context) {
	groupID := c.Param("groupId")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少群组ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	members, err := groupSvc.GetMembers(ctx, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": members})
}

// AddGroupMember 拉人进群
func AddGroupMember(c *gin.Context) {
	userID := mustGetUserID(c)
	groupID := c.Param("groupId")

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.UserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少用户ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := groupSvc.AddMember(ctx, groupID, req.UserID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 广播新成员加入通知
	im.GetManager().BroadcastGroupMemberJoin(groupID, req.UserID)

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已邀请用户进群"})
}

// UpdateGroupName 修改群名
func UpdateGroupName(c *gin.Context) {
	groupID := c.Param("groupId")

	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "群名称不能为空"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := groupSvc.UpdateGroupName(ctx, groupID, req.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 广播群信息更新
	im.GetManager().BroadcastGroupUpdate(groupID, req.Name, "")

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "群名已更新"})
}

// RemoveGroupMember 踢人/退群
func RemoveGroupMember(c *gin.Context) {
	groupID := c.Param("groupId")
	userID := c.Param("userId")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少用户ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := groupSvc.RemoveMember(ctx, groupID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已移除群成员"})
}

// DissolveGroup 解散群组
func DissolveGroup(c *gin.Context) {
	userID := mustGetUserID(c)
	groupID := c.Param("groupId")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := groupSvc.DissolveGroup(ctx, groupID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "群组已解散"})
}

// MarkGroupMessagesRead 标记群消息为已读
func MarkGroupMessagesRead(c *gin.Context) {
	groupID := c.Param("groupId")

	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少消息ID列表"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := groupMsgSvc.MarkGroupMessagesRead(ctx, groupID, req.IDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已标记已读"})
}
