package middleware

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWTConfig JWT 配置（外部注入）
type JWTConfig struct {
	Secret      string
	ExpireHours int
}

// 全局 JWT 配置（由 main.go 初始化后注入）
var jwtCfg *JWTConfig

// SetJWTConfig 设置 JWT 配置（main.go 启动时调用）
func SetJWTConfig(cfg *JWTConfig) {
	jwtCfg = cfg
}

// Claims JWT 声明结构
type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// JWTAuth JWT 登录鉴权中间件
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "缺少 Authorization 请求头",
			})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "Authorization 格式错误，应为 Bearer <token>",
			})
			c.Abort()
			return
		}

		tokenString := parts[1]
		claims, err := ParseToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "无效或过期的 Token",
			})
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Next()
	}
}

// GenerateToken 生成 JWT Token
func GenerateToken(userID, email string) (string, error) {
	claims := &Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(jwtCfg.ExpireHours) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "go-chat-server",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(jwtCfg.Secret))
}

// ParseToken 从 token 字符串解析 JWT Claims（供 WebSocket 等非 HTTP 上下文使用）
func ParseToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(jwtCfg.Secret), nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("无效或过期的 Token")
	}
	return claims, nil
}
