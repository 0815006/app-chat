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
  Group,
  GroupMember,
} from '../types'

/**
 * 基于 Go 后端 (Gin + WebSocket) 的聊天服务实现
 * 实现 IChatService 接口，二期启用
 */
class GoChatService implements IChatService {
  private ws: WebSocket | null = null

  /**
   * HTTP 请求基路径。
   * 开发模式：空字符串 → 走 Vite 代理（避免跨域 CORS 错误）
   * 生产模式：直连 Go 后端绝对地址
   */
  private baseUrl(): string {
    if (import.meta.env.DEV) {
      return ''  // 相对路径 → Vite 代理 → Go 后端
    }
    return import.meta.env.VITE_GO_BASE_URL || 'http://127.0.0.1:8080'
  }

  /**
   * WebSocket 连接地址。
   * 开发/生产统一用绝对 URL（WebSocket 不走 Vite HTTP 代理，Go 后端 CORS 中间件放行）
   */
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

    // 持久化 token 到 localStorage，供路由守卫和 restoreSession 使用
    if (json.data.token) {
      localStorage.setItem('go-chat-token', json.data.token as string)
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

    // 持久化 token 到 localStorage
    if (json.data.token) {
      localStorage.setItem('go-chat-token', json.data.token as string)
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
    // 清除持久化的 token
    localStorage.removeItem('go-chat-token')
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

    // Go 后端 RecoverSession 直接返回 data = User 对象（非嵌套 data.user）
    const u = json.data as User
    return { user: u, session: token }
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
    // Go 后端返回 DESC（新→旧），翻转为 ASC（旧→新）对齐 Supabase 行为
    const msgs = (json.data ?? []) as Message[]
    msgs.reverse()
    return [msgs, json.has_more as boolean]
  }

  async sendMessage(msgData: SendMessageParams): Promise<Message> {
    const token = localStorage.getItem('go-chat-token')

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // WebSocket 实时发送（type: 'chat' 对齐 Go 后端 onMessage 路由）
      this.ws.send(JSON.stringify({
        type: 'chat',
        sender_id: msgData.sender_id,
        receiver_id: msgData.receiver_id,
        content: msgData.content,
        msg_type: msgData.msg_type,
        group_id: msgData.group_id,
        file_name: msgData.file_name,
        file_size: msgData.file_size,
      }))

      // 返回一个临时消息（Go 后端会通过 WebSocket 推送正式消息）
      return {
        id: '',
        sender_id: msgData.sender_id,
        receiver_id: msgData.receiver_id,
        content: msgData.content,
        msg_type: msgData.msg_type,
        group_id: msgData.group_id,
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

  // WebSocket 消息分流回调（通过 WebSocket 聚合所有实时事件）
  private onMessageCallback: ((message: Message) => void) | null = null
  private onOnlineStatusCallback: ((event: { userId: string; isOnline: boolean }) => void) | null = null
  private onGroupMemberJoinCallback: ((event: { groupId: string; userId: string }) => void) | null = null
  private onGroupUpdateCallback: ((event: { groupId: string; name: string; avatar_url: string }) => void) | null = null

  subscribeToMessages(callback: (message: Message) => void): () => void {
    const token = localStorage.getItem('go-chat-token')
    if (!token) {
      console.warn('[GoChatService] 无 token，跳过 WebSocket 连接')
      return () => {}
    }

    this.onMessageCallback = callback
    this.ws = new WebSocket(`${this.wsUrl()}?token=${token}`)

    this.ws.onopen = () => {
      console.log('[GoChatService] WebSocket 连接已建立')
    }

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data)
        switch (raw.type) {
          case 'chat':
          case 'message_revoke':
            this.onMessageCallback?.(raw as Message)
            break
          case 'online_status':
            this.onOnlineStatusCallback?.({
              userId: raw.user_id as string,
              isOnline: raw.is_online as boolean,
            })
            break
          case 'group_member_join':
            this.onGroupMemberJoinCallback?.({
              groupId: raw.group_id as string,
              userId: raw.user_id as string,
            })
            break
          case 'group_update':
            this.onGroupUpdateCallback?.({
              groupId: raw.group_id as string,
              name: raw.name as string,
              avatar_url: raw.avatar_url as string,
            })
            break
          default:
            // 兼容旧格式（无 type 字段的纯 Message）
            this.onMessageCallback?.(raw as Message)
        }
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
    const token = localStorage.getItem('go-chat-token')
    if (!token) return
    await fetch(`${this.baseUrl()}/api/users/online`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  async goOffline(): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    if (!token) return
    await fetch(`${this.baseUrl()}/api/users/offline`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  subscribeToOnlineStatus(callback: (event: { userId: string; isOnline: boolean }) => void): () => void {
    this.onOnlineStatusCallback = callback
    return () => {
      this.onOnlineStatusCallback = null
    }
  }

  async updateProfile(nickname: string): Promise<User> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nickname }),
    })

    if (!res.ok) throw new Error(`更新个人信息失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`更新个人信息失败: ${json.message}`)
    return json.data as User
  }

  async updateAvatar(file: File): Promise<string> {
    const token = localStorage.getItem('go-chat-token')
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`${this.baseUrl()}/api/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    if (!res.ok) throw new Error(`上传头像失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`上传头像失败: ${json.message}`)
    return json.data.avatar_url as string
  }

  async deleteAvatar(): Promise<string> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/me/avatar`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`删除头像失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`删除头像失败: ${json.message}`)
    return json.data.avatar_url as string
  }

  // ==================== 群组 ====================

  async createGroup(name: string, memberIds: string[]): Promise<Group> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, member_ids: memberIds }),
    })

    if (!res.ok) throw new Error(`创建群组失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`创建群组失败: ${json.message}`)
    return json.data as Group
  }

  async fetchGroups(): Promise<Group[]> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(`${this.baseUrl()}/api/groups`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`获取群组列表失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`获取群组列表失败: ${json.message}`)
    // Go GroupResponse 字段与前端 Group 接口一一对应，无需转换
    return (json.data ?? []) as Group[]
  }

  async fetchGroupHistory(groupId: string, limit: number = 20, before?: string): Promise<[Message[], boolean]> {
    const token = localStorage.getItem('go-chat-token')
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)

    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}/history?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!res.ok) throw new Error(`获取群聊历史失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`获取群聊历史失败: ${json.message}`)
    // Go 后端返回 DESC（新→旧），翻转为 ASC（旧→新）对齐 Supabase 行为
    const msgs = (json.data ?? []) as Message[]
    msgs.reverse()
    return [msgs, json.has_more as boolean]
  }

  async fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}/members`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!res.ok) throw new Error(`获取群成员失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`获取群成员失败: ${json.message}`)

    // Go 返回 GroupMember[] 含 Preload("User")，需扁平化为前端 GroupMember 类型
    const members = (json.data ?? []) as Array<{
      id: string
      group_id: string
      user_id: string
      role: 'owner' | 'admin' | 'member'
      joined_at: string
      user?: {
        id: string
        nickname: string
        employee_id?: string
        avatar_url?: string
        email?: string
        created_at?: string
        updated_at?: string
      }
    }>

    return members.map((m) => ({
      id: m.id,
      group_id: m.group_id,
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      nickname: m.user?.nickname ?? '未知用户',
      avatar_url: m.user?.avatar_url,
      employee_id: m.user?.employee_id ?? '',
      is_online: false,
    }))
  }

  async addGroupMember(groupId: string, userId: string): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}/members`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      }
    )

    if (!res.ok) throw new Error(`拉人进群失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`拉人进群失败: ${json.message}`)
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    if (!res.ok) throw new Error(`移除群成员失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`移除群成员失败: ${json.message}`)
  }

  async dissolveGroup(groupId: string): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    if (!res.ok) throw new Error(`解散群组失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`解散群组失败: ${json.message}`)
  }

  async updateGroupName(groupId: string, name: string): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}/name`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      }
    )

    if (!res.ok) throw new Error(`修改群名失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`修改群名失败: ${json.message}`)
  }

  async markGroupMessagesAsRead(groupId: string, messageIds: string[]): Promise<void> {
    const token = localStorage.getItem('go-chat-token')
    const res = await fetch(
      `${this.baseUrl()}/api/groups/${encodeURIComponent(groupId)}/messages/read`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids: messageIds }),
      }
    )

    if (!res.ok) throw new Error(`标记群消息已读失败: HTTP ${res.status}`)
    const json = await res.json()
    if (json.code !== 200) throw new Error(`标记群消息已读失败: ${json.message}`)
  }

  subscribeToGroupMembers(callback: (event: { groupId: string; userId: string }) => void): () => void {
    this.onGroupMemberJoinCallback = callback
    return () => {
      this.onGroupMemberJoinCallback = null
    }
  }

  subscribeToGroupUpdates(callback: (event: { groupId: string; name: string; avatar_url: string }) => void): () => void {
    this.onGroupUpdateCallback = callback
    return () => {
      this.onGroupUpdateCallback = null
    }
  }
}

export { GoChatService }
