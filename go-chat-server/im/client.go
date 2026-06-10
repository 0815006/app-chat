package im

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/olahol/melody"
)

// Client 代表单个在线 WebSocket 客户端连接
type Client struct {
	UserID   string          `json:"user_id"`
	Email    string          `json:"email"`
	Session  *melody.Session `json:"-"`
	OnlineAt time.Time       `json:"online_at"`
	mu       sync.RWMutex
}

// WSMessage WebSocket 消息标准格式
type WSMessage struct {
	Type       string `json:"type"`        // chat / typing / read_receipt / heartbeat
	SenderID   string `json:"sender_id"`
	ReceiverID string `json:"receiver_id"`
	Content    string `json:"content"`
	MsgType    string `json:"msg_type"`    // text / image / file / voice
	MessageID  string `json:"message_id,omitempty"`
	Timestamp  int64  `json:"timestamp"`
}

// NewClient 创建新的客户端实例
func NewClient(userID, email string, session *melody.Session) *Client {
	return &Client{
		UserID:   userID,
		Email:    email,
		Session:  session,
		OnlineAt: time.Now(),
	}
}

// SendJSON 向该客户端发送 JSON 消息
func (c *Client) SendJSON(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.Session.Write(data)
}
