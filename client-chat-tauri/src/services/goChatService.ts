import type {
  IChatService,
  LoginParams,
  RegisterParams,
  Message,
  SendMessageParams,
  UploadParams,
  UploadResult,
  User,
  Friend,
} from '../types'

/**
 * 基于 Go 后端 (Gin + WebSocket) 的聊天服务实现
 * 实现 IChatService 接口，二期启用
 */
class GoChatService implements IChatService {
  private ws: WebSocket | null = null

  private baseUrl(): string {
    return import.meta.env.VITE_GO_BASE_URL || 'http://127.0.0.1:8080'
  }

  private wsUrl(): string {
    return import.meta.env.VITE_GO_WS_URL || 'ws://127.0.0.1:8080/ws'
  }

  // ==================== 认证 ====================

  async login(params: LoginParams): Promise<{ user: User; session: unknown }> {
    const res = await fetch(`${this.baseUrl()}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: params.email, password: params.password }),
    })

    if (!res.ok) {
      throw new Error(`登录失败: HTTP ${res.status}`)
    }

    const json = await res.json()
    if (json.code !== 200) {
      throw new Error(`登录失败: ${json.message}`)
    }

    return { user: json.data.user, session: json.data.token }
  }

  async register(params: RegisterParams): Promise<{ user: User; session: unknown }> {
    const res = await fetch(`${this.baseUrl()}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        employee_id: params.employeeId,
        nickname: params.nickname,
      }),
    })

    if (!res.ok) {
      throw new Error(`注册失败: HTTP ${res.status}`)
    }

    const json = await res.json()
    if (json.code !== 200) {
      throw new Error(`注册失败: ${json.message}`)
    }

    return { user: json.data.user, session: json.data.token }
  }

  async logout(): Promise<void> {
    // 先标记离线
    await this.goOffline()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  async restoreSession(): Promise<{ user: User; session: unknown } | null> {
    // Go 后端通过 localStorage 中的 token 恢复会话
    const token = localStorage.getItem('go-chat-token')
    if (!token) return null

    const res = await fetch(`${this.baseUrl()}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      localStorage.removeItem('go-chat-token')
      return null
    }

    const json = await res.json()
    if (json.code !== 200) return null

    return { user: json.data.user, session: token }
  }

  // ==================== 消息 ====================

  async fetchHistory(
    senderId: string,
    receiverId: string,
    limit: number = 20,
    before?: string
  ): Promise<[Message[], boolean]> {
    const token = localStorage.getItem('go-chat-token')
    const params = new URLSearchParams({
      sender_id: senderId,
      receiver_id: receiverId,
      limit: String(limit),
    })
    if (before) params.set('before', before)

    const res = await fetch(
      `${this.baseUrl()}/api/history?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!res.ok) throw new Error(`获取历史消息失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`获取历史消息失败: ${json.message}`)
    return [json.data as Message[], json.has_more as boolean]
  }

  async sendMessage(msgData: SendMessageParams): Promise<Message> {
    const token = localStorage.getItem('go-chat-token')

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // WebSocket 实时发送
      this.ws.send(JSON.stringify({
        type: 'message',
        sender_id: msgData.sender_id,
        receiver_id: msgData.receiver_id,
        content: msgData.content,
        msg_type: msgData.msg_type,
      }))

      // 返回一个临时消息（Go 后端会通过 WebSocket 推送正式消息）
      return {
        id: '',
        sender_id: msgData.sender_id,
        receiver_id: msgData.receiver_id,
        content: msgData.content,
        msg_type: msgData.msg_type,
        created_at: new Date().toISOString(),
      }
    }

    // 退化到 HTTP REST
    const res = await fetch(`${this.baseUrl()}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(msgData),
    })

    if (!res.ok) throw new Error(`发送消息失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`发送消息失败: ${json.message}`)
    return json.data as Message
  }

  async uploadFile(_params: UploadParams): Promise<UploadResult> {
    const token = localStorage.getItem('go-chat-token')
    const formData = new FormData()
    formData.append('file', _params.file)
    formData.append('user_id', _params.userId)
    formData.append('type', _params.type)

    const res = await fetch(`${this.baseUrl()}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    if (!res.ok) throw new Error(`文件上传失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`文件上传失败: ${json.message}`)
    return {
      url: json.data.url as string,
      file_name: _params.file.name,
      file_size: _params.file.size,
    }
  }

  async markAsRead(messageIds: string[]): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    await fetch(`${this.baseUrl()}/api/messages/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids: messageIds }),
    })
  }

  async revokeMessage(messageId: string): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/messages/${messageId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) throw new Error(`撤回消息失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`撤回消息失败: ${json.message}`)
  }

  // ==================== 好友管理 ====================

  async fetchFriends(): Promise<Friend[]> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`获取好友列表失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`获取好友列表失败: ${json.message}`)
    return json.data as Friend[]
  }

  async addFriend(friendId: string): Promise<Friend> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/friends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ friend_id: friendId }),
    })

    if (!res.ok) throw new Error(`添加好友失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`添加好友失败: ${json.message}`)
    return json.data as Friend
  }

  async removeFriend(friendId: string): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/friends/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`删除好友失败: HTTP ${res.status}`)
  }

  async searchUsers(query: string): Promise<User[]> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/users/search?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!res.ok) throw new Error(`搜索用户失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`搜索用户失败: ${json.message}`)
    return json.data as User[]
  }

  async fetchAllUsers(sort?: string): Promise<User[]> {
    const token = localStorage.getItem('go-chat-token')
    const params = new URLSearchParams()
    if (sort) params.set('sort', sort)

    const qs = params.toString()
    const res = await fetch(`${this.baseUrl()}/api/users${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`获取用户列表失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`获取用户列表失败: ${json.message}`)
    return json.data as User[]
  }

  // ==================== 实时消息 ====================

  subscribeToMessages(callback: (message: Message) => void): () => void {
    const token = localStorage.getItem('go-chat-token')
    this.ws = new WebSocket(`${this.wsUrl()}?token=${token}`)

    this.ws.onopen = () => {
      console.log('[GoChatService] WebSocket 连接已建立')
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as Message
        callback(msg)
      } catch {
        console.error('[GoChatService] WebSocket 消息解析失败')
      }
    }

    this.ws.onerror = (err) => {
      console.error('[GoChatService] WebSocket 错误:', err)
    }

    this.ws.onclose = () => {
      console.log('[GoChatService] WebSocket 连接已关闭')
    }

    return () => {
      if (this.ws) {
        this.ws.close()
        this.ws = null
      }
    }
  }

  // ==================== 在线状态 ====================

  async goOnline(): Promise<void> {
    // Go 后端可通过 HTTP PUT /api/users/online 实现
  }

  async goOffline(): Promise<void> {
    // Go 后端可通过 HTTP PUT /api/users/offline 实现
  }

  subscribeToOnlineStatus(_callback: (event: { userId: string; isOnline: boolean }) => void): () => void {
    // Go 后端暂不支持，返回空操作
    return () => {}
  }

  async updateProfile(_nickname: string): Promise<User> {
    throw new Error('Go 后端暂不支持修改个人信息')
  }

  async updateAvatar(_file: File): Promise<string> {
    throw new Error('Go 后端暂不支持上传头像')
  }

  async deleteAvatar(): Promise<string> {
    throw new Error('Go 后端暂不支持删除头像')
  }
}

export { GoChatService }
