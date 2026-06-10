package model

import (
	"time"
)

// Friendship 好友关系表 (双向存储)
// A 加 B 为好友时，同时写入 (A, B) 和 (B, A) 两条记录
type Friendship struct {
	ID        string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
	UserID    string    `json:"user_id" gorm:"type:varchar(36);not null;index;comment:用户ID"`
	FriendID  string    `json:"friend_id" gorm:"type:varchar(36);not null;index;comment:好友ID"`
	Status    string    `json:"status" gorm:"type:varchar(20);not null;default:'pending';comment:accepted/pending"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`

	// 关联好友资料（非外键约束，仅用于 JOIN 查询填充）
	Friend *User `json:"friend,omitempty" gorm:"foreignKey:FriendID;references:ID"`
}

// TableName 指定表名
func (Friendship) TableName() string {
	return "friendships"
}
