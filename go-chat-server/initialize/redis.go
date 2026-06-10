package initialize

import (
	"context"
	"fmt"
	"go-chat-server/config"
	"go-chat-server/global"
	"time"

	"github.com/redis/go-redis/v9"
)

// InitRedis 初始化 Redis 客户端
func InitRedis(cfg *config.Config) error {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("连接 Redis 失败: %w", err)
	}

	global.RDB = rdb
	return nil
}
