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

// WSMessage WebSocket 消息标准格式（对齐前端 Message 接口）
type WSMessage struct {
	Type       string   `json:"type"`         // chat / typing / read_receipt / heartbeat / heartbeat_ack / online_status / message_revoke / group_member_join / group_update / friend_added
	ID         string   `json:"id,omitempty"` // 消息ID（对齐前端 Message.id）
	SenderID   string   `json:"sender_id,omitempty"`
	ReceiverID string   `json:"receiver_id,omitempty"`
	GroupID    string   `json:"group_id,omitempty"` // 群组ID
	Content    string   `json:"content,omitempty"`
	MsgType    string   `json:"msg_type,omitempty"` // text / image / file / voice
	IsRead     bool     `json:"is_read,omitempty"`
	IsRevoked  bool     `json:"is_revoked,omitempty"`
	FileName   string   `json:"file_name,omitempty"`
	FileSize   int64    `json:"file_size,omitempty"`
	MentionIDs []string `json:"mention_ids,omitempty"` // @提及的用户ID列表
	CreatedAt  string   `json:"created_at,omitempty"`  // ISO 时间字符串
	Timestamp  int64    `json:"timestamp,omitempty"`   // 保留兼容

	// online_status 专用字段
	UserID   string `json:"user_id,omitempty"`   // online_status / group_member_join / friend_added 中的目标用户
	IsOnline bool   `json:"is_online,omitempty"` // online_status 中的在线状态

	// friend_added 专用字段
	FriendID string `json:"friend_id,omitempty"` // friend_added 中的发起好友者 ID

	// group_update 专用字段
	Name      string `json:"name,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`

	// read_receipt 专用字段
	MessageIDs []string `json:"message_ids,omitempty"` // 批量已读回执
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
