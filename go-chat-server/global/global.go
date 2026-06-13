package global

import (
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// DB 全局 MySQL 数据库连接
var DB *gorm.DB

// RDB 全局 Redis 客户端（nil 时表示 Redis 未启用）
var RDB *redis.Client
