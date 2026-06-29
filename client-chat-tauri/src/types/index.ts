// ========== 核心数据对象类型 ==========

/** @所有人 特殊标记常量 */
export const MENTION_ALL = 'ALL'

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
  /** 接收者 user id (uuid)；群聊时 receiver_id 与 sender_id 相同（满足 FK 约束） */
  receiver_id: string
  /** 群组 ID (uuid)；群聊时非空，单聊时为 NULL */
  group_id?: string
  /** 发送时间 (ISO string) */
  created_at: string
  /** 是否已读 */
  is_read?: boolean
  /** 是否已撤回 */
  is_revoked?: boolean
  /** 原始文件名（仅 file/image/voice 类型使用） */
  file_name?: string
  /** 文件字节数（仅 file/image/voice 类型使用） */
  file_size?: number
  /** 被 @ 的用户 ID 列表（仅群聊）；含 "ALL" 表示 @所有人 */
  mention_ids?: string[]
}

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
  /** 注册时间 (ISO string) */
  created_at?: string
  /** 主题偏好，默认 dark */
  theme?: 'dark' | 'light'
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
  /** 最后一条消息类型（用于区分 [图片]/[文件]/[语音] 标签） */
  last_message_type?: Message['msg_type']
  /** 最后消息时间 */
  last_message_at?: string
  /** 未读消息数 */
  unread_count?: number
  /** 好友的 employee_id */
  employee_id?: string
}

/** 群组 */
export interface Group {
  /** 物理主键 (uuid) */
  id: string
  /** 群组名称 */
  name: string
  /** 群头像 URL */
  avatar_url?: string
  /** 群主 user id */
  owner_id: string
  /** 创建时间 (ISO string) */
  created_at: string
  /** 成员数量（由 fetchGroups 聚合填充） */
  member_count?: number
  /** 最后一条消息摘要 */
  last_message?: string
  /** 最后一条消息类型 */
  last_message_type?: Message['msg_type']
  /** 最后消息时间 */
  last_message_at?: string
  /** 未读消息数 */
  unread_count?: number
}

/** 群成员 */
export interface GroupMember {
  /** 物理主键 (uuid) */
  id: string
  /** 群组 ID */
  group_id: string
  /** 用户 ID */
  user_id: string
  /** 角色 */
  role: 'owner' | 'admin' | 'member'
  /** 加入时间 (ISO string) */
  joined_at: string
  /** 成员昵称（关联查询填充） */
  nickname?: string
  /** 成员头像 */
  avatar_url?: string
  /** 成员工号 */
  employee_id?: string
  /** 在线状态 */
  is_online?: boolean
}

/** "当前聊天目标"联合类型：可以是好友私聊，也可以是群聊 */
export interface ChatTarget {
  type: 'friend' | 'group'
  /** friend_id 或 group_id */
  id: string
  /** 展示名称 */
  name: string
  /** 头像 URL */
  avatar_url?: string
  /** 仅 friend 类型：是否在线 */
  online?: boolean
  /** 仅 friend 类型：最后消息时间 */
  last_message_at?: string
}

/** 用户列表排序字段 */
export type UserSortField = 'created_at' | 'nickname' | 'employee_id'

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
  /** 群组 ID，群聊时传入（单聊不传） */
  group_id?: string
  /** 被 @ 的用户 ID 列表（仅群聊）；含 "ALL" 表示 @所有人 */
  mention_ids?: string[]
  /** 原始文件名（仅 file/image/voice 类型使用） */
  file_name?: string
  /** 文件字节数（仅 file/image/voice 类型使用） */
  file_size?: number
}

/** 文件上传结果 */
export interface UploadResult {
  /** 公开访问 URL */
  url: string
  /** 原始文件名 */
  file_name: string
  /** 文件字节数 */
  file_size: number
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
  /** 分页拉取历史消息；limit 默认 20，返回 [消息列表, 是否还有更多] */
  fetchHistory(senderId: string, receiverId: string, limit?: number, before?: string): Promise<[Message[], boolean]>
  sendMessage(msgData: SendMessageParams): Promise<Message>
  uploadFile(params: UploadParams): Promise<UploadResult>
  markAsRead(messageIds: string[]): Promise<void>
  searchUsers(query: string): Promise<User[]>
  fetchAllUsers(sort?: UserSortField): Promise<User[]>
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
  /** 撤回消息 — 调用方为发送者本人 */
  revokeMessage(messageId: string): Promise<void>
  /** 更新用户昵称，返回更新后的完整 User */
  updateProfile(nickname: string): Promise<User>
  /** 上传头像图片，返回新的 avatar_url */
  updateAvatar(file: File): Promise<string>
  /** 删除头像（恢复为默认无头像状态） */
  deleteAvatar(): Promise<string>

  // ========== 群聊 ==========
  /** 创建群组 + 同时添加群主和成员；返回创建的 Group */
  createGroup(name: string, memberIds: string[]): Promise<Group>
  /** 获取当前用户已加入的群组列表 */
  fetchGroups(): Promise<Group[]>
  /** 按群组 ID 分页拉取历史群消息 */
  fetchGroupHistory(groupId: string, limit?: number, before?: string): Promise<[Message[], boolean]>
  /** 获取群成员列表 */
  fetchGroupMembers(groupId: string): Promise<GroupMember[]>
  /** 拉人进群（任何群成员均可邀请） */
  addGroupMember(groupId: string, userId: string): Promise<void>
  /** 修改群组名称（任何群成员均可修改） */
  updateGroupName(groupId: string, name: string): Promise<void>
  /** 踢人 / 退出群聊 */
  removeGroupMember(groupId: string, userId: string): Promise<void>
  /** 解散群组（仅群主） */
  dissolveGroup(groupId: string): Promise<void>
  /** 标记群消息为已读 */
  markGroupMessagesAsRead(groupId: string, messageIds: string[]): Promise<void>
  /** 订阅 group_members 表 INSERT 事件（被邀请进群时实时感知） */
  subscribeToGroupMembers(callback: (event: { groupId: string; userId: string }) => void): () => void
  /** 订阅 groups 表 UPDATE 事件（群名修改时所有成员实时同步） */
  subscribeToGroupUpdates(callback: (event: { groupId: string; name: string; avatar_url: string }) => void): () => void
  /** 更新用户主题偏好，返回更新后的完整 User */
  updateTheme(theme: 'dark' | 'light'): Promise<User>

  // ========== 好友关系实时感知 ==========
  /** 订阅 friendships 表 INSERT 事件（被别人添加为好友时实时感知）；返回取消订阅函数 */
  subscribeToFriendships(callback: (event: { userId: string; friendId: string }) => void): () => void
}