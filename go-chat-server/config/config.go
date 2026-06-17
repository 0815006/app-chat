package config

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

// Config 全局配置结构体
type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	JWT      JWTConfig      `mapstructure:"jwt"`
	Upload   UploadConfig   `mapstructure:"upload"`
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"`
}

// DatabaseConfig 数据库配置
type DatabaseConfig struct {
	Host      string `mapstructure:"host"`
	Port      int    `mapstructure:"port"`
	User      string `mapstructure:"user"`
	Password  string `mapstructure:"password"`
	DBName    string `mapstructure:"dbname"`
	Charset   string `mapstructure:"charset"`
	ParseTime bool   `mapstructure:"parse_time"`
	Loc       string `mapstructure:"loc"`
}

// DSN 返回 MySQL 连接字符串
func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=%s&parseTime=%t&loc=%s",
		d.User, d.Password, d.Host, d.Port, d.DBName, d.Charset, d.ParseTime, d.Loc)
}

// RedisConfig Redis 配置
type RedisConfig struct {
	Enable   bool   `mapstructure:"enable"`
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

// JWTConfig JWT 配置
type JWTConfig struct {
	Secret      string `mapstructure:"secret"`
	ExpireHours int    `mapstructure:"expire_hours"`
}

// UploadConfig 文件上传配置
type UploadConfig struct {
	Dir       string `mapstructure:"dir"`        // 上传文件存储目录
	MaxImg    int64  `mapstructure:"max_img"`    // 图片最大尺寸(MB)
	MaxFile   int64  `mapstructure:"max_file"`   // 文件最大尺寸(MB)
	MaxVoice  int64  `mapstructure:"max_voice"`  // 语音最大尺寸(MB)
	URLPrefix string `mapstructure:"url_prefix"` // 静态文件访问 URL 前缀
}

var cfg *Config

// expandEnvVars 展开字符串中的 ${VAR:default} 语法。
// ${VAR}        → os.Getenv("VAR")，不存在则为空
// ${VAR:default} → os.Getenv("VAR")，不存在或为空则返回 default
// 只按第一个 ':' 分割 key，以兼容默认值中包含 ':' 的场景（如 D:\path、http://）。
func expandEnvVars(s string) string {
	return os.Expand(s, func(key string) string {
		if idx := strings.Index(key, ":"); idx >= 0 {
			envName := key[:idx]
			defaultVal := key[idx+1:]
			if val, ok := os.LookupEnv(envName); ok && val != "" {
				return val
			}
			return defaultVal
		}
		return os.Getenv(key)
	})
}

// Load 加载配置文件。
// 流程：手动读取 config.yaml 原始字节 → 展开 ${VAR:default} → 喂给 viper 反序列化。
func Load() (*Config, error) {
	// 尝试多个路径查找配置文件
	configPaths := []string{"./config/config.yaml", "config.yaml"}
	var content []byte
	var loadedPath string
	var err error

	for _, p := range configPaths {
		content, err = os.ReadFile(p)
		if err == nil {
			loadedPath = p
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败（已查找: %s）: %w", strings.Join(configPaths, ", "), err)
	}

	expanded := expandEnvVars(string(content))

	viper.SetConfigType("yaml")
	if err := viper.ReadConfig(bytes.NewReader([]byte(expanded))); err != nil {
		return nil, fmt.Errorf("解析配置文件失败 (%s): %w", loadedPath, err)
	}

	cfg = &Config{}
	if err := viper.Unmarshal(cfg); err != nil {
		return nil, fmt.Errorf("解析配置结构体失败: %w", err)
	}

	return cfg, nil
}

// Get 获取全局配置单例
func Get() *Config {
	return cfg
}

// FindConfigPath 查找 config.yaml 文件（复用 Load 的查找逻辑）。
func FindConfigPath() (string, error) {
	configPaths := []string{"./config/config.yaml", "config.yaml"}
	for _, p := range configPaths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("未找到 config.yaml（已查找: %s）", strings.Join(configPaths, ", "))
}

// ExpandConfigFile 读取 config.yaml → 展开 ${VAR:default} → 写入 dstPath。
// 用于构建时（如 build-server-lan.ps1）将变量模板展开为写死值的配置文件。
// 返回展开后的字节数。
func ExpandConfigFile(dstPath string) (int, error) {
	srcPath, err := FindConfigPath()
	if err != nil {
		return 0, err
	}

	content, err := os.ReadFile(srcPath)
	if err != nil {
		return 0, fmt.Errorf("读取 %s 失败: %w", srcPath, err)
	}

	expanded := expandEnvVars(string(content))

	// 确保目标目录存在
	if dir := filepath.Dir(dstPath); dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return 0, fmt.Errorf("创建目录 %s 失败: %w", dir, err)
		}
	}

	if err := os.WriteFile(dstPath, []byte(expanded), 0644); err != nil {
		return 0, fmt.Errorf("写入 %s 失败: %w", dstPath, err)
	}

	return len(expanded), nil
}
