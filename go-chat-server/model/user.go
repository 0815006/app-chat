package model

import (
	"time"
)

// User 用户资料表结构体
// id 为 UUID 主键，employee_id 为 7 位展示工号
type User struct {
	ID         string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
	Nickname   string    `json:"nickname" gorm:"type:varchar(100);not null;comment:用户昵称"`
	Email      string    `json:"email" gorm:"type:varchar(255);uniqueIndex;not null;comment:邮箱/登录账号"`
	Password   string    `json:"-" gorm:"type:varchar(255);not null;comment:bcrypt密码哈希"`
	EmployeeID string    `json:"employee_id" gorm:"type:varchar(10);comment:7位工号，仅展示用"`
	AvatarURL  string    `json:"avatar_url" gorm:"type:varchar(500);comment:头像URL"`
	Theme      string    `json:"theme" gorm:"type:varchar(10);default:dark;comment:用户主题偏好：dark | light"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt  time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

// TableName 指定表名
func (User) TableName() string {
	return "users"
}
