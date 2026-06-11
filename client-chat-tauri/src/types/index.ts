// ========== 核心数据对象类型 ==========

/** 用户/员工 */
export interface User {
  /** 物理主键 (uuid) */
  id: string
  /** 员工唯一标识，7位数字字符串，如 '0001234' */
  employee_id: string
  /** 员工昵称/姓名 */
  nickname: string
  /** 头像 URL */
  avatar_url?: string
  /** 状态 */
  status?: 'online' | 'offline' | 'away'
  /** 邮箱 */
  email?: string
}

/** 聊天消息 */
export interface Message {
  /** 物理主键 (uuid) */
  id: string
  /** 消息类型 */
  msg_type: 'text' | 'image' | 'file' | 'voice'
  /** 消息内容 (文本内容或文件 URL) */
  content: string
  /** 发送者 user id (uuid) */
  sender_id: string
  /** 接收者 user id (uuid) */
  receiver_id: string
  /** 发送时间 (ISO string) */
  created_at: string
  /** 是否已读 */
  is_read?: boolean
}

/** 好友关系 */
export interface Friend {
  /** 物理主键 (uuid) */
  id: string
  /** 好友的 user id */
  friend_id: string
  /** 好友姓名 */
  name: string
  /** 在线状态 */
  online?: boolean
  /** 好友头像 */
  avatar_url?: string
  /** 最后一条消息摘要 */
  last_message?: string
  /** 最后消息时间 */
  last_message_at?: string
  /** 未读消息数 */
  unread_count?: number
  /** 好友的 employee_id */
  employee_id?: string
}

/** 聊天服务后端类型 */
export type ChatServiceType = 'supabase' | 'golang'

// ========== 聊天服务接口抽象 ==========

/** 登录参数 */
export interface LoginParams {
  email: string
  password: string
}

/** 注册参数 */
export interface RegisterParams {
  email: string
  password: string
  employeeId: string
  nickname: string
}

/** 发送消息参数 */
export interface SendMessageParams {
  content: string
  msg_type: Message['msg_type']
  sender_id: string
  receiver_id: string
}

/** 文件上传参数 */
export interface UploadParams {
  file: File
  /** 上传者 user id */
  userId: string
  /** 文件类型 */
  type: 'image' | 'file' | 'voice'
}

/** 聊天服务接口——所有实现（Supabase / Go API）必须遵循 */
export interface IChatService {
  login(params: LoginParams): Promise<{ user: User; session: unknown }>
  register(params: RegisterParams): Promise<{ user: User; session: unknown }>
  logout(): Promise<void>
  restoreSession(): Promise<{ user: User; session: unknown } | null>
  fetchHistory(senderId: string, receiverId: string): Promise<Message[]>
  sendMessage(msgData: SendMessageParams): Promise<Message>
  uploadFile(params: UploadParams): Promise<string>
  markAsRead(messageIds: string[]): Promise<void>
  searchUsers(query: string): Promise<User[]>
  addFriend(friendId: string): Promise<Friend>
  removeFriend(friendId: string): Promise<void>
  fetchFriends(): Promise<Friend[]>
  subscribeToMessages(callback: (message: Message) => void): () => void
  /** 标记当前用户上线 */
  goOnline(): Promise<void>
  /** 标记当前用户离线 */
  goOffline(): Promise<void>
  /** 订阅 profiles 表 is_online 字段变更，回调传入 {userId, isOnline} */
  subscribeToOnlineStatus(callback: (event: { userId: string; isOnline: boolean }) => void): () => void
  /** 更新用户昵称，返回更新后的完整 User */
  updateProfile(nickname: string): Promise<User>
  /** 上传头像图片，返回新的 avatar_url */
  updateAvatar(file: File): Promise<string>
}