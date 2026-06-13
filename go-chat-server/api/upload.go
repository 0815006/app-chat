package api

import (
	"context"
	"net/http"
	"time"

	"go-chat-server/service"

	"github.com/gin-gonic/gin"
)

var uploadSvc = &service.UploadService{}

// UploadFile 上传聊天文件
func UploadFile(c *gin.Context) {
	userID := mustGetUserID(c)

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请选择文件"})
		return
	}

	fileType := c.PostForm("type")
	if fileType == "" {
		fileType = "file"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	url, fileName, fileSize, err := uploadSvc.UploadFile(ctx, userID, fileType, file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "上传成功",
		"data": gin.H{
			"url":       url,
			"file_name": fileName,
			"file_size": fileSize,
		},
	})
}
