package api

import (
	"context"
	"net/http"
	"time"

	"go-chat-server/service"

	"github.com/gin-gonic/gin"
)

var userSvc = &service.UserService{}

// Register 用户注册
func Register(c *gin.Context) {
	var req service.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if req.Email == "" || req.Password == "" || req.Nickname == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "邮箱、密码、昵称不能为空",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	resp, err := userSvc.Register(ctx, req)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{
			"code":    409,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "注册成功",
		"data":    resp,
	})
}

// Login 用户登录
func Login(c *gin.Context) {
	var req service.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if req.Email == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "邮箱和密码不能为空",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	resp, err := userSvc.Login(ctx, req)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "登录成功",
		"data":    resp,
	})
}

// GetMe 获取当前登录用户信息
func GetMe(c *gin.Context) {
	userID, _ := c.Get("user_id")

	u, err := userSvc.GetByID(c.Request.Context(), userID.(string))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    404,
			"message": "用户不存在",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "success",
		"data":    u,
	})
}
