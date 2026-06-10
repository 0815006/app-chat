package service

import (
	"context"
	"errors"
	"fmt"

	"go-chat-server/global"
	"go-chat-server/middleware"
	"go-chat-server/model"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// UserService 用户业务逻辑
type UserService struct{}

// RegisterRequest 注册请求
type RegisterRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	Nickname   string `json:"nickname"`
	EmployeeID string `json:"employee_id"`
}

// RegisterResponse 注册响应
type RegisterResponse struct {
	User  model.User `json:"user"`
	Token string     `json:"token"`
}

// Register 用户注册
func (s *UserService) Register(ctx context.Context, req RegisterRequest) (*RegisterResponse, error) {
	var exist model.User
	if err := global.DB.WithContext(ctx).Where("email = ?", req.Email).First(&exist).Error; err == nil {
		return nil, errors.New("该邮箱已被注册")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("密码加密失败: %w", err)
	}

	user := model.User{
		ID:         uuid.New().String(),
		Nickname:   req.Nickname,
		Email:      req.Email,
		Password:   string(hash),
		EmployeeID: req.EmployeeID,
	}

	if err := global.DB.WithContext(ctx).Create(&user).Error; err != nil {
		return nil, fmt.Errorf("创建用户失败: %w", err)
	}

	token, err := middleware.GenerateToken(user.ID, user.Email)
	if err != nil {
		return nil, fmt.Errorf("生成 Token 失败: %w", err)
	}

	return &RegisterResponse{User: user, Token: token}, nil
}

// LoginRequest 登录请求
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginResponse 登录响应
type LoginResponse struct {
	User  model.User `json:"user"`
	Token string     `json:"token"`
}

// Login 用户登录
func (s *UserService) Login(ctx context.Context, req LoginRequest) (*LoginResponse, error) {
	var user model.User
	if err := global.DB.WithContext(ctx).Where("email = ?", req.Email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("邮箱或密码错误")
		}
		return nil, fmt.Errorf("查询用户失败: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return nil, errors.New("邮箱或密码错误")
	}

	token, err := middleware.GenerateToken(user.ID, user.Email)
	if err != nil {
		return nil, fmt.Errorf("生成 Token 失败: %w", err)
	}

	return &LoginResponse{User: user, Token: token}, nil
}

// GetByID 根据 ID 获取用户
func (s *UserService) GetByID(ctx context.Context, id string) (*model.User, error) {
	var user model.User
	if err := global.DB.WithContext(ctx).Where("id = ?", id).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}
