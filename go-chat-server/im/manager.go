package im

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"go-chat-server/global"
	"go-chat-server/middleware"
	"go-chat-server/model"
	"go-chat-server/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/olahol/melody"
	redis "github.com/redis/go-redis/v9"
)

// Manager 核心 Hub：管理在线人员、消息路由
type Manager struct {
	m         *melody.Melody
	clients   map[string]*Client // key: userID
	mu        sync.RWMutex
	msgStore  *service.MessageStoreService
	onlineKey string // Redis 在线状态 Key 前缀
}

var (
	instance *Manager
	once     sync.Once
)

// GetManager 获取 Manager 单例
func GetManager() *Manager {
	once.Do(func() {
		instance = &Manager{
			m:         melody.New(),
			clients:   make(map[string]*Client),
			msgStore:  &service.MessageStoreService{},
			onlineKey: "online:",
		}
		instance.setupCallbacks()
	})
	return instance
}

// setupCallbacks 注册 Melody 事件回调
func (mgr *Manager) setupCallbacks() {
	mgr.m.HandleConnect(mgr.onConnect)
	mgr.m.HandleMessage(mgr.onMessage)
	mgr.m.HandleDisconnect(mgr.onDisconnect)
}

// HandleWebSocketGin 处理 WebSocket 升级请求（Gin handler 签名）
func (mgr *Manager) HandleWebSocketGin(c *gin.Context) {
	// 从查询参数获取 token 并鉴权
	tokenStr := c.Query("token")
	if tokenStr == "" {
		c.JSON(401, gin.H{"code": 401, "message": "缺少 token 参数"})
		return
	}

	// 存储 token 到请求上下文，供 melody onConnect 回调使用
	c.Request.Header.Set("Authorization", "Bearer "+tokenStr)
	c.Set("ws_token", tokenStr)

	mgr.m.HandleRequest(c.Writer, c.Request)
}

// onConnect 客户端连接建立回调
func (mgr *Manager) onConnect(s *melody.Session) {
	// 从请求中获取 token
	req := s.Request
	tokenStr := req.URL.Query().Get("token")
	if tokenStr == "" {
		s.Close()
		return
	}

	// 解析 JWT 获取用户信息
	claims, err := middleware.ParseToken(tokenStr)
	if err != nil {
		log.Printf("WebSocket JWT 解析失败: %v", err)
		s.Close()
		return
	}

	client := NewClient(claims.UserID, claims.Email, s)
	s.Set("user_id", claims.UserID)

	mgr.mu.Lock()
	// 如果用户已有旧连接，先关闭
	if old, ok := mgr.clients[claims.UserID]; ok {
		old.Session.Close()
	}
	mgr.clients[claims.UserID] = client
	mgr.mu.Unlock()

	// 设置 Redis 在线状态
	if global.RDB != nil {
		ctx := context.Background()
		global.RDB.Set(ctx, mgr.onlineKey+claims.UserID, "1", 0)
	}

	// 广播在线状态变更给所有在线好友
	go mgr.broadcastOnlineStatus(claims.UserID, true)

	// 推送离线期间的消息
	go mgr.pushOfflineMessages(claims.UserID)

	log.Printf("用户 %s (%s) 上线", claims.UserID, claims.Email)
}

// onDisconnect 客户端断开回调
func (mgr *Manager) onDisconnect(s *melody.Session) {
	userID, exists := s.Get("user_id")
	if !exists {
		return
	}

	uid := userID.(string)

	mgr.mu.Lock()
	delete(mgr.clients, uid)
	mgr.mu.Unlock()

	// 删除 Redis 在线状态
	if global.RDB != nil {
		ctx := context.Background()
		global.RDB.Del(ctx, mgr.onlineKey+uid)
	}

	// 广播在线状态变更
	go mgr.broadcastOnlineStatus(uid, false)

	log.Printf("用户 %s 下线", uid)
}

// onMessage 收到消息回调
func (mgr *Manager) onMessage(s *melody.Session, data []byte) {
	userID, exists := s.Get("user_id")
	if !exists {
		return
	}

	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("消息解析失败: %v", err)
		return
	}

	msg.SenderID = userID.(string)
	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}

	switch msg.Type {
	case "chat":
		mgr.routeChatMessage(&msg)
	case "typing":
		mgr.routeTypingNotification(&msg)
	case "read_receipt":
		mgr.routeReadReceipt(&msg)
	case "heartbeat":
		mgr.sendToClient(userID.(string), WSMessage{
			Type:      "heartbeat_ack",
			Timestamp: msg.Timestamp,
		})
	default:
		log.Printf("未知消息类型: %s", msg.Type)
	}
}

// routeChatMessage 路由聊天消息
func (mgr *Manager) routeChatMessage(msg *WSMessage) {
	ctx := context.Background()

	// 异步写入 MySQL
	stored, err := mgr.msgStore.StoreMessage(ctx, msg.SenderID, msg.ReceiverID, msg.GroupID, msg.Content, msg.MsgType, msg.FileName, msg.FileSize)
	if err != nil {
		log.Printf("消息持久化失败: %v", err)
	}
	if stored != nil {
		msg.ID = stored.ID
		msg.CreatedAt = stored.CreatedAt.Format(time.RFC3339)
	}

	// 构造响应消息
	resp := WSMessage{
		Type:       "chat",
		ID:         msg.ID,
		SenderID:   msg.SenderID,
		ReceiverID: msg.ReceiverID,
		GroupID:    msg.GroupID,
		Content:    msg.Content,
		MsgType:    msg.MsgType,
		IsRead:     false,
		IsRevoked:  false,
		FileName:   msg.FileName,
		FileSize:   msg.FileSize,
		CreatedAt:  msg.CreatedAt,
		Timestamp:  msg.Timestamp,
	}

	// 群聊消息处理
	if msg.GroupID != "" {
		mgr.routeGroupMessage(ctx, &resp)
		return
	}

	// 私聊消息处理
	// 回显给发送方（确认已送达）
	mgr.sendToClient(msg.SenderID, resp)

	// 检查接收方是否在线
	online := mgr.isOnlineInner(msg.ReceiverID)
	if online {
		// 在线：直接推送
		mgr.sendToClient(msg.ReceiverID, resp)
	} else {
		// 离线：存入 Redis 离线消息队列
		mgr.storeOfflineMessage(ctx, msg.ReceiverID, &resp)
	}
}

// routeGroupMessage 路由群聊消息给所有在线群成员
func (mgr *Manager) routeGroupMessage(ctx context.Context, msg *WSMessage) {
	// 获取群成员
	memberIDs, err := (&service.GroupService{}).GetMemberUserIDs(ctx, msg.GroupID)
	if err != nil {
		log.Printf("获取群成员失败: %v", err)
		mgr.sendToClient(msg.SenderID, *msg)
		return
	}

	for _, memberID := range memberIDs {
		if memberID == msg.SenderID {
			continue // 跳过发送者自己（后面单独回显）
		}
		if mgr.isOnlineInner(memberID) {
			mgr.sendToClient(memberID, *msg)
		} else {
			mgr.storeOfflineMessage(ctx, memberID, msg)
		}
	}

	// 回显给发送方
	mgr.sendToClient(msg.SenderID, *msg)
}

// routeTypingNotification 路由正在输入通知
func (mgr *Manager) routeTypingNotification(msg *WSMessage) {
	if msg.GroupID != "" {
		// 群聊广播给群成员
		ctx := context.Background()
		memberIDs, err := (&service.GroupService{}).GetMemberUserIDs(ctx, msg.GroupID)
		if err != nil {
			return
		}
		for _, memberID := range memberIDs {
			if memberID != msg.SenderID {
				mgr.sendToClient(memberID, *msg)
			}
		}
	} else {
		mgr.sendToClient(msg.ReceiverID, *msg)
	}
}

// routeReadReceipt 路由已读回执
func (mgr *Manager) routeReadReceipt(msg *WSMessage) {
	ctx := context.Background()
	// 支持批量标记已读
	if len(msg.MessageIDs) > 0 {
		if err := mgr.msgStore.BatchMarkAsRead(ctx, msg.MessageIDs); err != nil {
			log.Printf("批量标记已读失败: %v", err)
		}
	} else if msg.ID != "" {
		if err := mgr.msgStore.MarkAsRead(ctx, msg.ID); err != nil {
			log.Printf("标记已读失败: %v", err)
		}
	}

	if msg.GroupID != "" {
		// 群聊已读回执不广播
		return
	}
	mgr.sendToClient(msg.ReceiverID, *msg)
}

// sendToClient 向指定用户发送消息
func (mgr *Manager) sendToClient(userID string, msg interface{}) {
	mgr.mu.RLock()
	client, ok := mgr.clients[userID]
	mgr.mu.RUnlock()

	if !ok {
		return
	}

	if err := client.SendJSON(msg); err != nil {
		log.Printf("向用户 %s 发送消息失败: %v", userID, err)
	}
}

// storeOfflineMessage 存储离线消息到 Redis
func (mgr *Manager) storeOfflineMessage(ctx context.Context, userID string, msg *WSMessage) {
	if global.RDB == nil {
		return
	}
	key := "offline_msg:" + userID
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("序列化离线消息失败: %v", err)
		return
	}
	// LPUSH 到离线消息列表
	global.RDB.LPush(ctx, key, string(data))
	// 设置过期时间（7天）
	global.RDB.Expire(ctx, key, 7*24*time.Hour)
}

// pushOfflineMessages 推送离线消息
func (mgr *Manager) pushOfflineMessages(userID string) {
	if global.RDB == nil {
		return
	}
	ctx := context.Background()
	key := "offline_msg:" + userID
	for {
		result, err := global.RDB.RPop(ctx, key).Result()
		if err == redis.Nil {
			break
		}
		if err != nil {
			log.Printf("读取离线消息失败: %v", err)
			break
		}

		var msg WSMessage
		if err := json.Unmarshal([]byte(result), &msg); err != nil {
			continue
		}

		mgr.sendToClient(userID, msg)
	}
}

// broadcastOnlineStatus 向所有在线好友广播在线状态变更
func (mgr *Manager) broadcastOnlineStatus(userID string, isOnline bool) {
	msg := WSMessage{
		Type:     "online_status",
		UserID:   userID,
		IsOnline: isOnline,
	}

	mgr.mu.RLock()
	defer mgr.mu.RUnlock()

	// 广播给所有在线客户端
	for _, client := range mgr.clients {
		if client.UserID == userID {
			continue // 不给自己发
		}
		if err := client.SendJSON(msg); err != nil {
			log.Printf("广播在线状态给 %s 失败: %v", client.UserID, err)
		}
	}
}

// BroadcastMessageRevoke 广播消息撤回通知
func (mgr *Manager) BroadcastMessageRevoke(msg *model.Message) {
	wsMsg := WSMessage{
		Type:       "message_revoke",
		ID:         msg.ID,
		SenderID:   msg.SenderID,
		ReceiverID: msg.ReceiverID,
		GroupID:    msg.GroupID,
		IsRevoked:  true,
	}

	if msg.GroupID != "" {
		ctx := context.Background()
		memberIDs, err := (&service.GroupService{}).GetMemberUserIDs(ctx, msg.GroupID)
		if err != nil {
			return
		}
		for _, memberID := range memberIDs {
			mgr.sendToClient(memberID, wsMsg)
		}
	} else {
		mgr.sendToClient(msg.SenderID, wsMsg)
		mgr.sendToClient(msg.ReceiverID, wsMsg)
	}
}

// BroadcastGroupMemberJoin 广播群成员加入通知
func (mgr *Manager) BroadcastGroupMemberJoin(groupID, userID string) {
	msg := WSMessage{
		Type:    "group_member_join",
		GroupID: groupID,
		UserID:  userID,
	}

	ctx := context.Background()
	memberIDs, err := (&service.GroupService{}).GetMemberUserIDs(ctx, groupID)
	if err != nil {
		return
	}
	for _, memberID := range memberIDs {
		mgr.sendToClient(memberID, msg)
	}
}

// BroadcastGroupUpdate 广播群信息更新通知
func (mgr *Manager) BroadcastGroupUpdate(groupID, name, avatarURL string) {
	msg := WSMessage{
		Type:      "group_update",
		GroupID:   groupID,
		Name:      name,
		AvatarURL: avatarURL,
	}

	ctx := context.Background()
	memberIDs, err := (&service.GroupService{}).GetMemberUserIDs(ctx, groupID)
	if err != nil {
		return
	}
	for _, memberID := range memberIDs {
		mgr.sendToClient(memberID, msg)
	}
}

// isOnlineInner 内部检查用户是否在线（无需锁）
func (mgr *Manager) isOnlineInner(userID string) bool {
	if global.RDB != nil {
		ctx := context.Background()
		result, err := global.RDB.Get(ctx, mgr.onlineKey+userID).Result()
		if err == nil && result == "1" {
			return true
		}
	}
	// 降级：检查本地在线列表
	mgr.mu.RLock()
	_, ok := mgr.clients[userID]
	mgr.mu.RUnlock()
	return ok
}

// IsOnline 检查用户是否在线
func (mgr *Manager) IsOnline(userID string) bool {
	return mgr.isOnlineInner(userID)
}

// GetOnlineUsers 获取所有在线用户 ID 列表
func (mgr *Manager) GetOnlineUsers() []string {
	mgr.mu.RLock()
	defer mgr.mu.RUnlock()
	users := make([]string, 0, len(mgr.clients))
	for id := range mgr.clients {
		users = append(users, id)
	}
	return users
}

// MarkUserOnline 显式标记用户上线（HTTP 端点使用）
func (mgr *Manager) MarkUserOnline(userID string) {
	if global.RDB != nil {
		ctx := context.Background()
		global.RDB.Set(ctx, mgr.onlineKey+userID, "1", 0)
	}
	go mgr.broadcastOnlineStatus(userID, true)
}

// MarkUserOffline 显式标记用户离线（HTTP 端点使用）
func (mgr *Manager) MarkUserOffline(userID string) {
	if global.RDB != nil {
		ctx := context.Background()
		global.RDB.Del(ctx, mgr.onlineKey+userID)
	}
	go mgr.broadcastOnlineStatus(userID, false)
}
