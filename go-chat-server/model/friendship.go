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

// --- 聚合响应类型（非数据库表，仅用于 JSON 序列化） ---

// FriendResponse 好友列表聚合响应（对齐前端 Friend 类型）
type FriendResponse struct {
	ID              string  `json:"id"`
	FriendID        string  `json:"friend_id"`
	Name            string  `json:"name"`
	EmployeeID      string  `json:"employee_id,omitempty"`
	AvatarURL       string  `json:"avatar_url,omitempty"`
	Online          bool    `json:"online"`
	LastMessage     *string `json:"last_message,omitempty"`
	LastMessageType *string `json:"last_message_type,omitempty"`
	LastMessageAt   *string `json:"last_message_at,omitempty"`
	UnreadCount     int     `json:"unread_count"`
}

// --- 群组相关模型 ---

// Group 群组表
type Group struct {
	ID        string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
	Name      string    `json:"name" gorm:"type:varchar(200);not null;comment:群组名称"`
	AvatarURL string    `json:"avatar_url" gorm:"type:varchar(500);comment:群头像URL"`
	OwnerID   string    `json:"owner_id" gorm:"type:varchar(36);not null;index;comment:群主ID"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// TableName 指定表名
func (Group) TableName() string {
	return "groups"
}

// GroupMember 群成员表
type GroupMember struct {
	ID       string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
	GroupID  string    `json:"group_id" gorm:"type:varchar(36);not null;index;comment:群组ID"`
	UserID   string    `json:"user_id" gorm:"type:varchar(36);not null;index;comment:用户ID"`
	Role     string    `json:"role" gorm:"type:varchar(20);not null;default:'member';comment:owner/admin/member"`
	JoinedAt time.Time `json:"joined_at" gorm:"autoCreateTime;comment:加入时间"`

	// 关联
	User  *User  `json:"user,omitempty" gorm:"foreignKey:UserID;references:ID"`
	Group *Group `json:"group,omitempty" gorm:"foreignKey:GroupID;references:ID"`
}

// TableName 指定表名
func (GroupMember) TableName() string {
	return "group_members"
}

// GroupResponse 群组列表聚合响应（对齐前端 Group 类型）
type GroupResponse struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	AvatarURL       string  `json:"avatar_url,omitempty"`
	OwnerID         string  `json:"owner_id"`
	MemberCount     int     `json:"member_count"`
	LastMessage     *string `json:"last_message,omitempty"`
	LastMessageType *string `json:"last_message_type,omitempty"`
	LastMessageAt   *string `json:"last_message_at,omitempty"`
	UnreadCount     int     `json:"unread_count"`
	CreatedAt       string  `json:"created_at,omitempty"`
}
