package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"go-chat-server/service"

	"github.com/gin-gonic/gin"
)

var friendSvc = &service.FriendshipService{}
var msgStoreSvc = &service.MessageStoreService{}

// AddFriend 添加好友（双向存储）
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

	userID, _ := c.Get("user_id")
	uid := userID.(string)
	if uid == req.FriendID {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "不能添加自己为好友"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	resp, err := friendSvc.AddFriend(ctx, uid, req.FriendID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "好友申请已发送", "data": resp})
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

	userID, _ := c.Get("user_id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := friendSvc.AcceptFriend(ctx, friendshipID, userID.(string)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已通过好友申请"})
}

// ListFriends 获取好友列表
func ListFriends(c *gin.Context) {
	userID, _ := c.Get("user_id")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	friends, err := friendSvc.ListFriends(ctx, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": friends})
}

// GetHistory 获取历史消息
func GetHistory(c *gin.Context) {
	userID, _ := c.Get("user_id")
	friendID := c.Query("friend_id")
	if friendID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少 friend_id 参数"})
		return
	}

	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	messages, err := msgStoreSvc.GetHistory(ctx, userID.(string), friendID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": messages})
}
