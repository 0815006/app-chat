package service

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go-chat-server/config"

	"github.com/google/uuid"
)

// UploadService 文件上传服务
type UploadService struct {
	userSvc *UserService
}

// UploadAvatar 上传用户头像（限制 5MB，仅图片）
func (s *UploadService) UploadAvatar(ctx context.Context, userID string, fileHeader *multipart.FileHeader) (string, error) {
	cfg := config.Get()
	maxSize := cfg.Upload.MaxImg * 1024 * 1024 // 默认 10MB，头像用图片限制
	if maxSize <= 0 {
		maxSize = 5 * 1024 * 1024
	}

	// 检查文件类型
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if !isImageExt(ext) {
		return "", fmt.Errorf("仅支持图片格式（jpg/jpeg/png/gif/webp）")
	}

	if fileHeader.Size > maxSize {
		return "", fmt.Errorf("头像大小不能超过 %dMB", maxSize/(1024*1024))
	}

	// 生成文件名
	fileName := fmt.Sprintf("avatars/%s/%d_%s%s", userID, time.Now().UnixMilli(), uuid.New().String()[:8], ext)
	return s.saveFile(ctx, fileHeader, fileName)
}

// UploadFile 上传聊天文件
func (s *UploadService) UploadFile(ctx context.Context, userID, fileType string, fileHeader *multipart.FileHeader) (string, string, int64, error) {
	cfg := config.Get()

	var maxSize int64
	var subDir string
	switch fileType {
	case "image":
		maxSize = cfg.Upload.MaxImg * 1024 * 1024
		subDir = "images"
	case "file":
		maxSize = cfg.Upload.MaxFile * 1024 * 1024
		subDir = "files"
	case "voice":
		maxSize = cfg.Upload.MaxVoice * 1024 * 1024
		subDir = "voice"
	default:
		return "", "", 0, fmt.Errorf("不支持的文件类型: %s", fileType)
	}

	if maxSize <= 0 {
		maxSize = 10 * 1024 * 1024
	}

	if fileHeader.Size > maxSize {
		return "", "", 0, fmt.Errorf("文件大小不能超过 %dMB", maxSize/(1024*1024))
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	fileName := fmt.Sprintf("%s/%s/%d_%s%s", subDir, userID, time.Now().UnixMilli(), uuid.New().String()[:8], ext)

	url, err := s.saveFile(ctx, fileHeader, fileName)
	if err != nil {
		return "", "", 0, err
	}

	return url, fileHeader.Filename, fileHeader.Size, nil
}

// saveFile 保存文件到本地磁盘
func (s *UploadService) saveFile(ctx context.Context, fileHeader *multipart.FileHeader, relativePath string) (string, error) {
	cfg := config.Get()
	uploadDir := cfg.Upload.Dir
	if uploadDir == "" {
		uploadDir = "./uploads"
	}

	fullPath := filepath.Join(uploadDir, relativePath)

	// 确保目录存在
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("创建上传目录失败: %w", err)
	}

	// 打开源文件
	src, err := fileHeader.Open()
	if err != nil {
		return "", fmt.Errorf("打开上传文件失败: %w", err)
	}
	defer src.Close()

	// 创建目标文件
	dst, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("创建目标文件失败: %w", err)
	}
	defer dst.Close()

	// 拷贝
	if _, err := io.Copy(dst, src); err != nil {
		return "", fmt.Errorf("保存文件失败: %w", err)
	}

	// 构造公开访问 URL
	urlPrefix := cfg.Upload.URLPrefix
	if urlPrefix == "" {
		urlPrefix = "http://127.0.0.1:8080/uploads"
	}
	url := fmt.Sprintf("%s/%s", strings.TrimRight(urlPrefix, "/"), relativePath)

	return url, nil
}

func isImageExt(ext string) bool {
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
		return true
	}
	return false
}
