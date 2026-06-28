package im

import (
	"encoding/json"

	"go-chat-server/model"
)

// SendToUser 向指定用户发送 WebSocket 消息（公开方法，供 api 层使用）
func (mgr *Manager) SendToUser(userID string, msg WSMessage) {
	mgr.sendToClient(userID, msg)
}

// SendChatToUser 发送聊天消息给指定用户（简化版）
func (mgr *Manager) SendChatToUser(senderID, receiverID string, stored *model.Message) {
	mgr.sendToClient(receiverID, WSMessage{
		Type:       "chat",
		ID:         stored.ID,
		SenderID:   stored.SenderID,
		ReceiverID: stored.ReceiverID,
		GroupID:    stored.GroupID,
		Content:    stored.Content,
		MsgType:    stored.MsgType,
		MentionIDs: parseMentionJSON(stored.MentionIDs),
		IsRead:     stored.IsRead,
		IsRevoked:  stored.IsRevoked,
		FileName:   stored.FileName,
		FileSize:   stored.FileSize,
		CreatedAt:  stored.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	})
}

// parseMentionJSON 将 JSON 字符串解析为 []string
func parseMentionJSON(raw string) []string {
	if raw == "" {
		return nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil
	}
	return ids
}
