package initialize

import (
	"fmt"
	"go-chat-server/config"
	"go-chat-server/global"
	"go-chat-server/model"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// InitDB 初始化 MySQL 连接并执行 AutoMigrate
func InitDB(cfg *config.Config) error {
	dsn := cfg.Database.DSN()

	var logLevel logger.LogLevel
	if cfg.Server.Mode == "release" {
		logLevel = logger.Warn
	} else {
		logLevel = logger.Info
	}

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})
	if err != nil {
		return fmt.Errorf("连接 MySQL 失败: %w", err)
	}

	// 自动迁移表结构
	if err := db.AutoMigrate(
		&model.User{},
		&model.Message{},
		&model.Friendship{},
		&model.Group{},
		&model.GroupMember{},
	); err != nil {
		return fmt.Errorf("AutoMigrate 失败: %w", err)
	}

	global.DB = db
	return nil
}
