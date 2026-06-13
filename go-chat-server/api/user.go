package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"go-chat-server/im"
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

// UpdateMe 更新当前用户资料（昵称）
func UpdateMe(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		Nickname string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Nickname == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "昵称不能为空"})
		return
	}

	u, err := userSvc.UpdateNickname(c.Request.Context(), userID.(string), req.Nickname)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "更新成功", "data": u})
}

// UploadAvatar 上传头像
func UploadAvatar(c *gin.Context) {
	userID, _ := c.Get("user_id")

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请选择文件"})
		return
	}

	uploadSvc := &service.UploadService{}
	url, err := uploadSvc.UploadAvatar(c.Request.Context(), userID.(string), file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	// 将头像 URL 持久化到 users 表，否则重新登录后丢失
	if _, err := userSvc.UpdateAvatar(c.Request.Context(), userID.(string), url); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "保存头像失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "上传成功",
		"data":    gin.H{"avatar_url": url},
	})
}

// DeleteAvatar 删除头像
func DeleteAvatar(c *gin.Context) {
	userID, _ := c.Get("user_id")

	_, err := userSvc.DeleteAvatar(c.Request.Context(), userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已删除头像", "data": gin.H{"avatar_url": ""}})
}

// RecoverSession 恢复会话（验证 token 有效性并返回用户信息）
func RecoverSession(c *gin.Context) {
	userID, _ := c.Get("user_id")

	u, err := userSvc.GetByID(c.Request.Context(), userID.(string))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "会话已过期",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "会话有效",
		"data":    u,
	})
}

// SearchUsers 搜索用户
func SearchUsers(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少搜索关键词 q"})
		return
	}

	users, err := userSvc.SearchUsers(c.Request.Context(), q, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": users})
}

// ListUsers 获取所有用户列表
func ListUsers(c *gin.Context) {
	sort := c.DefaultQuery("sort", "created_at")
	limitStr := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitStr)

	users, err := userSvc.ListUsers(c.Request.Context(), sort, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": users})
}

// MarkOnline 标记用户上线
func MarkOnline(c *gin.Context) {
	userID, _ := c.Get("user_id")
	im.GetManager().MarkUserOnline(userID.(string))
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已上线"})
}

// MarkOffline 标记用户离线
func MarkOffline(c *gin.Context) {
	userID, _ := c.Get("user_id")
	im.GetManager().MarkUserOffline(userID.(string))
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已离线"})
}

// --- 辅助：JSON 成功/失败响应 ---

func success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": data})
}

func fail(c *gin.Context, code int, msg string) {
	c.JSON(code, gin.H{"code": code, "message": msg})
}

// successWithHasMore 用于游标分页响应（含 has_more）
func successWithHasMore(c *gin.Context, data interface{}, hasMore bool) {
	c.JSON(http.StatusOK, gin.H{
		"code":     200,
		"message":  "success",
		"data":     data,
		"has_more": hasMore,
	})
}

// mustGetUserID 从上下文获取当前用户 ID（辅助函数）
func mustGetUserID(c *gin.Context) string {
	v, _ := c.Get("user_id")
	return v.(string)
}

// --- 内部使用 ---

func jsonMarshal(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}
