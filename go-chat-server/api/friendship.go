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

var friendSvc = &service.FriendshipService{}
var msgStoreSvc = &service.MessageStoreService{}

// AddFriend 添加好友（双向存储，直接 accepted）
func AddFriend(c *gin.Context) {
	var req struct {
		FriendID string `json:"friend_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请求参数错误: " + err.Error()})
		return
	}
	if req.FriendID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "好友ID不能为空"})
		return
	}

	userID := mustGetUserID(c)
	if userID == req.FriendID {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "不能添加自己为好友"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	resp, err := friendSvc.AddFriend(ctx, userID, req.FriendID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 通过 WebSocket 通知被添加方（目标用户）刷新好友列表
	im.GetManager().BroadcastFriendAdded(req.FriendID, userID)

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "添加好友成功", "data": resp})
}

// UpdateFriendStatus 更新好友关系状态（同意申请）
func UpdateFriendStatus(c *gin.Context) {
	friendshipID := c.Param("id")
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请求参数错误"})
		return
	}
	if req.Status != "accepted" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "状态值无效"})
		return
	}

	userID := mustGetUserID(c)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := friendSvc.AcceptFriend(ctx, friendshipID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已通过好友申请"})
}

// DeleteFriend 删除好友（双向删除）
func DeleteFriend(c *gin.Context) {
	friendID := c.Param("friendId")
	if friendID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少好友ID"})
		return
	}

	userID := mustGetUserID(c)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := friendSvc.DeleteFriend(ctx, userID, friendID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已删除好友"})
}

// ListFriends 获取好友列表（聚合响应）
func ListFriends(c *gin.Context) {
	userID := mustGetUserID(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	friends, err := friendSvc.ListFriends(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": friends})
}

// GetHistory 获取历史消息（游标分页）
func GetHistory(c *gin.Context) {
	userID := mustGetUserID(c)
	senderID := c.Query("sender_id")
	receiverID := c.Query("receiver_id")

	if senderID == "" || receiverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少 sender_id 或 receiver_id 参数"})
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

	// 双向查询：userID 与 senderID 或 receiverID 之一匹配即可
	partnerID := receiverID
	if userID == receiverID {
		partnerID = senderID
	}

	messages, hasMore, err := msgStoreSvc.GetHistory(ctx, userID, partnerID, before, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	successWithHasMore(c, messages, hasMore)
}

// SendMessageHTTP 发送消息（HTTP 退化路径，WebSocket 不可用时）
func SendMessageHTTP(c *gin.Context) {
	userID := mustGetUserID(c)

	var req struct {
		ReceiverID string   `json:"receiver_id"`
		GroupID    string   `json:"group_id,omitempty"`
		Content    string   `json:"content"`
		MsgType    string   `json:"msg_type"`
		MentionIDs []string `json:"mention_ids,omitempty"`
		FileName   string   `json:"file_name,omitempty"`
		FileSize   int64    `json:"file_size,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请求参数错误"})
		return
	}
	if req.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "消息内容不能为空"})
		return
	}
	if req.MsgType == "" {
		req.MsgType = "text"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	msg, err := msgStoreSvc.StoreMessage(ctx, userID, req.ReceiverID, req.GroupID, req.Content, req.MsgType, req.FileName, req.FileSize, req.MentionIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 尝试通过 WebSocket 推送
	mgr := im.GetManager()
	mgr.SendChatToUser(userID, req.ReceiverID, msg)

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "发送成功", "data": msg})
}

// BatchMarkRead 批量标记消息已读
func BatchMarkRead(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少消息ID列表"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := msgStoreSvc.BatchMarkAsRead(ctx, req.IDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已标记已读"})
}

// RevokeMessage 撤回消息
func RevokeMessage(c *gin.Context) {
	userID := mustGetUserID(c)
	messageID := c.Param("messageId")
	if messageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少消息ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	msg, err := msgStoreSvc.RevokeMessage(ctx, messageID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 通过 WebSocket 广播撤回通知
	im.GetManager().BroadcastMessageRevoke(msg)

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已撤回"})
}
