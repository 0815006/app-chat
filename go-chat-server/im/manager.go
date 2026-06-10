package im

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"go-chat-server/global"
	"go-chat-server/middleware"
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
	ctx := context.Background()
	global.RDB.Set(ctx, mgr.onlineKey+claims.UserID, "1", 0)

	// 推送离线期间的消息
	go mgr.pushOfflineMessages(ctx, claims.UserID)

	log.Printf("用户 %s (%s) 上线", claims.UserID, claims.Email)
}

// onDisconnect 客户端断开回调
func (mgr *Manager) onDisconnect(s *melody.Session) {
	userID, exists := s.Get("user_id")
	if !exists {
		return
	}

	mgr.mu.Lock()
	delete(mgr.clients, userID.(string))
	mgr.mu.Unlock()

	// 删除 Redis 在线状态
	ctx := context.Background()
	global.RDB.Del(ctx, mgr.onlineKey+userID.(string))

	log.Printf("用户 %s 下线", userID.(string))
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
	if msg.MessageID == "" {
		msg.MessageID = uuid.New().String()
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
	}
}

// routeChatMessage 路由聊天消息
func (mgr *Manager) routeChatMessage(msg *WSMessage) {
	ctx := context.Background()

	// 异步写入 MySQL
	stored, err := mgr.msgStore.StoreMessage(ctx, msg.SenderID, msg.ReceiverID, msg.Content, msg.MsgType)
	if err != nil {
		log.Printf("消息持久化失败: %v", err)
	}
	if stored != nil {
		msg.MessageID = stored.ID
	}

	// 构造响应消息
	resp := WSMessage{
		Type:       "chat",
		SenderID:   msg.SenderID,
		ReceiverID: msg.ReceiverID,
		Content:    msg.Content,
		MsgType:    msg.MsgType,
		MessageID:  msg.MessageID,
		Timestamp:  msg.Timestamp,
	}

	// 检查接收方是否在线
	online, _ := global.RDB.Get(ctx, mgr.onlineKey+msg.ReceiverID).Result()
	if online == "1" {
		// 在线：直接推送
		mgr.sendToClient(msg.ReceiverID, resp)
	} else {
		// 离线：存入 Redis 离线消息队列
		mgr.storeOfflineMessage(ctx, msg.ReceiverID, &resp)
	}

	// 回显给发送方（确认已送达）
	mgr.sendToClient(msg.SenderID, resp)
}

// routeTypingNotification 路由正在输入通知
func (mgr *Manager) routeTypingNotification(msg *WSMessage) {
	mgr.sendToClient(msg.ReceiverID, *msg)
}

// routeReadReceipt 路由已读回执
func (mgr *Manager) routeReadReceipt(msg *WSMessage) {
	ctx := context.Background()
	if err := mgr.msgStore.MarkAsRead(ctx, msg.MessageID); err != nil {
		log.Printf("标记已读失败: %v", err)
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
func (mgr *Manager) pushOfflineMessages(ctx context.Context, userID string) {
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

// IsOnline 检查用户是否在线
func (mgr *Manager) IsOnline(userID string) bool {
	mgr.mu.RLock()
	defer mgr.mu.RUnlock()
	_, ok := mgr.clients[userID]
	return ok
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

