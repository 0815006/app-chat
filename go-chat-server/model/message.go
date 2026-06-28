package model

import (
	"time"
)

// Message 聊天消息表
type Message struct {
	ID         string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
	SenderID   string    `json:"sender_id" gorm:"type:varchar(36);not null;index;comment:发送者ID"`
	ReceiverID string    `json:"receiver_id" gorm:"type:varchar(36);not null;index;comment:接收者ID"`
	GroupID    string    `json:"group_id,omitempty" gorm:"type:varchar(36);index;comment:群组ID(群聊时非空)"`
	Content    string    `json:"content" gorm:"type:text;not null;comment:文本存文字，文件/图片/语音存URL"`
	MsgType    string    `json:"msg_type" gorm:"type:varchar(20);not null;default:'text';comment:text/image/file/voice"`
	MentionIDs string    `json:"mention_ids,omitempty" gorm:"type:text;comment:被@的用户ID列表(JSON数组)"`
	IsRead     bool      `json:"is_read" gorm:"not null;default:false;comment:是否已读"`
	IsRevoked  bool      `json:"is_revoked" gorm:"not null;default:false;comment:是否已撤回"`
	FileName   string    `json:"file_name,omitempty" gorm:"type:varchar(500);comment:原始文件名"`
	FileSize   int64     `json:"file_size,omitempty" gorm:"comment:文件字节数"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime;index;comment:发送时间"`

	// 关联
	Sender   *User `json:"sender,omitempty" gorm:"foreignKey:SenderID;references:ID"`
	Receiver *User `json:"receiver,omitempty" gorm:"foreignKey:ReceiverID;references:ID"`
}

// TableName 指定表名
func (Message) TableName() string {
	return "messages"
}
