import { getSupabase } from '../utils/supabase'
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
 * 基于 Supabase 的聊天服务实现
 * 实现 IChatService 接口，未来可替换为 Go API 实现
 */
class SupabaseChatService implements IChatService {
  // ==================== 认证 ====================

  async login(params: LoginParams): Promise<{ user: User; session: unknown }> {
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    })

    if (error) {
      throw new Error(`登录失败: ${error.message}`)
    }

    // 读取 profiles 表获取完整用户信息
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()

    return {
      user: {
        id: data.user.id,
        employee_id: profile?.employee_id ?? '',
        nickname: profile?.nickname ?? data.user.email ?? params.email,
        email: data.user.email ?? params.email,
        avatar_url: profile?.avatar_url ?? undefined,
        status: 'online',
      },
      session: data.session,
    }
  }

  async register(params: RegisterParams): Promise<{ user: User; session: unknown }> {
    const supabase = getSupabase()
    // 1. Supabase Auth 注册
    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
    })

    if (error) {
      throw new Error(`注册失败: ${error.message}`)
    }

    if (!data.user) {
      throw new Error('注册失败: 未返回用户信息')
    }

    // 2. 写入 profiles 表
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      employee_id: params.employeeId,
      nickname: params.nickname,
    })

    if (profileError) {
      throw new Error(`创建用户信息失败: ${profileError.message}`)
    }

    return {
      user: {
        id: data.user.id,
        employee_id: params.employeeId,
        nickname: params.nickname,
        email: params.email,
        status: 'online',
      },
      session: data.session,
    }
  }

  async logout(): Promise<void> {
    // 先标记离线，再注销 session（顺序重要：signOut 后 auth.uid() 不可用）
    await this.goOffline()

    const supabase = getSupabase()
    const { error } = await supabase.auth.signOut()
    if (error) {
      throw new Error(`登出失败: ${error.message}`)
    }
  }

  async restoreSession(): Promise<{ user: User; session: unknown } | null> {
    const supabase = getSupabase()
    const { data } = await supabase.auth.getSession()

    if (!data.session) {
      return null
    }

    // 读取 profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.session.user.id)
      .single()

    return {
      user: {
        id: data.session.user.id,
        employee_id: profile?.employee_id ?? '',
        nickname: profile?.nickname ?? data.session.user.email ?? '',
        email: data.session.user.email,
        avatar_url: profile?.avatar_url ?? undefined,
        status: 'online',
      },
      session: data.session,
    }
  }

  // ==================== 消息 ====================

  async fetchHistory(
    senderId: string,
    receiverId: string,
    limit: number = 20,
    before?: string
  ): Promise<[Message[], boolean]> {
    const supabase = getSupabase()
    let query = supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${senderId},receiver_id.eq.${receiverId}),` +
        `and(sender_id.eq.${receiverId},receiver_id.eq.${senderId})`
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    // 游标分页：before 为上一页最早一条的 created_at
    if (before) {
      query = query.lt('created_at', before)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`获取历史消息失败: ${error.message}`)
    }

    const msgs = (data ?? []) as Message[]
    // 反转回正序（ascending）供 UI 渲染
    msgs.reverse()

    // hasMore：实际返回数 == limit 表示可能还有更多
    const hasMore = msgs.length >= limit

    return [msgs, hasMore]
  }

  async sendMessage(msgData: SendMessageParams): Promise<Message> {
    const supabase = getSupabase()
    const insertPayload: Record<string, unknown> = {
      content: msgData.content,
      msg_type: msgData.msg_type,
      sender_id: msgData.sender_id,
      receiver_id: msgData.receiver_id,
    }
    // 非文本消息携带文件元数据
    if (msgData.file_name) insertPayload.file_name = msgData.file_name
    if (msgData.file_size !== undefined) insertPayload.file_size = msgData.file_size

    const { data, error } = await supabase
      .from('messages')
      .insert(insertPayload)
      .select()
      .single()

    if (error) {
      throw new Error(`发送消息失败: ${error.message}`)
    }

    return data as Message
  }

  async markAsRead(messageIds: string[]): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .in('id', messageIds)

    if (error) {
      throw new Error(`标记已读失败: ${error.message}`)
    }
  }

  async revokeMessage(messageId: string): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from('messages')
      .update({
        is_revoked: true,
        content: '[消息已被撤回]',
        msg_type: 'text',
        file_name: null,
        file_size: null,
      })
      .eq('id', messageId)

    if (error) {
      throw new Error(`撤回消息失败: ${error.message}`)
    }
  }

  // ==================== 文件上传 ====================

  async uploadFile(params: UploadParams): Promise<UploadResult> {
    // 客户端文件大小前置校验
    const maxSizes: Record<UploadParams['type'], number> = {
      image: 10 * 1024 * 1024,   // 10MB
      file: 50 * 1024 * 1024,    // 50MB
      voice: 5 * 1024 * 1024,    // 5MB
    }
    const maxSize = maxSizes[params.type]
    if (params.file.size > maxSize) {
      const sizeMB = (maxSize / 1024 / 1024).toFixed(0)
      throw new Error(`文件大小超出限制：${params.type === 'image' ? '图片' : params.type === 'voice' ? '语音' : '文件'}最大 ${sizeMB}MB`)
    }

    const supabase = getSupabase()
    const fileExt = params.file.name.split('.').pop()
    const fileName = `${params.userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`

    const bucket = params.type === 'image'
      ? 'chat-images'
      : params.type === 'voice'
      ? 'chat-voice'
      : 'chat-files'

    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, params.file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (error) {
      if (error.message?.includes('Bucket') && error.message?.includes('not found')) {
        throw new Error(`存储桶 "${bucket}" 不存在，请先执行 docs/04_init_storage_buckets.sql 初始化`)
      }
      throw new Error(`文件上传失败: ${error.message}`)
    }

    // 获取公开访问 URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName)

    return {
      url: urlData.publicUrl,
      file_name: params.file.name,
      file_size: params.file.size,
    }
  }

  // ==================== 个人资料 ====================

  async updateProfile(nickname: string): Promise<User> {
    const supabase = getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data: profile, error } = await supabase
      .from('profiles')
      .update({ nickname, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select('id, nickname, employee_id, avatar_url')
      .single()

    if (error) throw new Error(`更新个人信息失败: ${error.message}`)

    return {
      id: user.id,
      employee_id: (profile as Record<string, unknown>)?.employee_id as string ?? '',
      nickname: (profile as Record<string, unknown>)?.nickname as string ?? user.email ?? '',
      avatar_url: (profile as Record<string, unknown>)?.avatar_url as string ?? undefined,
      email: user.email,
      status: 'online',
    }
  }

  async updateAvatar(file: File): Promise<string> {
    const supabase = getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    // 校验
    if (file.size > 5 * 1024 * 1024) throw new Error('头像图片不能超过 5MB')
    if (!file.type.startsWith('image/')) throw new Error('仅支持图片格式')

    const ext = file.name.split('.').pop() ?? 'png'
    // 路径第一级必须是当前用户 UUID（满足 Storage RLS 策略要求）
    const fileName = `${user.id}/avatars/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('chat-files')
      .upload(fileName, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      if (uploadError.message?.includes('Bucket') && uploadError.message?.includes('not found')) {
        throw new Error('存储桶 "chat-files" 不存在，请先执行 docs/init_storage_buckets.sql 初始化')
      }
      throw new Error(`头像上传失败: ${uploadError.message}`)
    }

    const { data: urlData } = supabase.storage
      .from('chat-files')
      .getPublicUrl(fileName)

    const avatarUrl = urlData.publicUrl

    // 更新 profiles 表
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (updateError) throw new Error(`更新头像记录失败: ${updateError.message}`)

    return avatarUrl
  }

  async deleteAvatar(): Promise<string> {
    const supabase = getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    // 将 profiles.avatar_url 置为 null，恢复默认无头像状态
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) throw new Error(`删除头像失败: ${error.message}`)

    // 返回空字符串表示已清除
    return ''
  }

  // ==================== 好友管理 ====================

  async fetchFriends(): Promise<Friend[]> {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('未登录')
    }

    // 查询好友关系表，关联 profiles 获取好友信息
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        id,
        friend_id,
        friend:profiles!friendships_friend_id_fkey (
          id,
          nickname,
          employee_id,
          avatar_url,
          is_online
        )
      `)
      .eq('user_id', user.id)

    if (error) {
      throw new Error(`获取好友列表失败: ${error.message}`)
    }

    // 同时获取每个好友的最后一条消息 + 未读计数
    const result: Friend[] = await Promise.all(
      (data ?? []).map(async (row: Record<string, unknown>) => {
        const friendProfile = Array.isArray(row.friend) ? row.friend[0] : row.friend
        const friendId = row.friend_id as string

        // 获取最后一条消息（含 msg_type）
        const { data: lastMsgs } = await supabase
          .from('messages')
          .select('content, msg_type, created_at')
          .or(
            `and(sender_id.eq.${user.id},receiver_id.eq.${friendId}),` +
            `and(sender_id.eq.${friendId},receiver_id.eq.${user.id})`
          )
          .order('created_at', { ascending: false })
          .limit(1)

        const lastMsg = lastMsgs?.[0] as Record<string, unknown> | undefined

        // 获取未读消息计数（对方发给我的 is_read=false 的消息数）
        const { count: unreadCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('sender_id', friendId)
          .eq('receiver_id', user.id)
          .eq('is_read', false)

        return {
          id: row.id as string,
          friend_id: friendId,
          name: (friendProfile as Record<string, unknown> | null)?.nickname as string ?? '未知用户',
          employee_id: (friendProfile as Record<string, unknown> | null)?.employee_id as string ?? '',
          avatar_url: (friendProfile as Record<string, unknown> | null)?.avatar_url as string ?? undefined,
          online: (friendProfile as Record<string, unknown> | null)?.is_online as boolean ?? false,
          last_message: lastMsg?.content as string | undefined,
          last_message_type: lastMsg?.msg_type as Message['msg_type'] | undefined,
          last_message_at: lastMsg?.created_at as string | undefined,
          unread_count: unreadCount ?? 0,
        }
      })
    )

    // 按最后消息时间倒序排列（有消息的在前，无消息的按好友添加时间）
    result.sort((a, b) => {
      const tA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const tB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return tB - tA
    })

    return result
  }

  async addFriend(friendId: string): Promise<Friend> {
    const supabase = getSupabase()

    // 使用 RPC 函数（SECURITY DEFINER 绕过 RLS 双向插入限制）
    const { data, error } = await supabase.rpc('add_friend', {
      p_friend_id: friendId,
    })

    if (error) {
      throw new Error(`添加好友失败: ${error.message}`)
    }

    // RPC 函数返回 JSONB，Supabase SDK 自动解析为对象
    const result = data as Record<string, unknown>
    return {
      id: (result.id as string) ?? '',
      friend_id: (result.friend_id as string) ?? friendId,
      name: (result.name as string) ?? '未知用户',
      employee_id: (result.employee_id as string) ?? '',
      avatar_url: (result.avatar_url as string) ?? undefined,
      online: false,
    }
  }

  async removeFriend(friendId: string): Promise<void> {
    const supabase = getSupabase()

    // 使用 RPC 函数（SECURITY DEFINER 绕过 RLS 双向删除限制）
    const { error } = await supabase.rpc('remove_friend', {
      p_friend_id: friendId,
    })

    if (error) {
      throw new Error(`删除好友失败: ${error.message}`)
    }
  }

  async searchUsers(query: string): Promise<User[]> {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nickname, employee_id, avatar_url, is_online, created_at')
      .or(`nickname.ilike.%${query}%,employee_id.ilike.%${query}%`)
      .limit(20)

    if (error) {
      throw new Error(`搜索用户失败: ${error.message}`)
    }

    return (data ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      employee_id: (p.employee_id as string) ?? '',
      nickname: p.nickname as string,
      email: '',
      avatar_url: (p.avatar_url as string) ?? undefined,
      status: ((p.is_online as boolean) ? 'online' : 'offline') as User['status'],
      created_at: (p.created_at as string) ?? undefined,
    }))
  }

  async fetchAllUsers(sort?: string): Promise<User[]> {
    const supabase = getSupabase()

    // 排序字段映射：前端字段 -> profiles 表列名
    const sortColumn = sort === 'employee_id' ? 'employee_id'
      : sort === 'nickname' ? 'nickname'
      : 'created_at'

    const { data, error } = await supabase
      .from('profiles')
      .select('id, nickname, employee_id, avatar_url, is_online, created_at')
      .order(sortColumn, { ascending: sortColumn === 'created_at' ? false : true })
      .limit(100)

    if (error) {
      throw new Error(`获取用户列表失败: ${error.message}`)
    }

    return (data ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      employee_id: (p.employee_id as string) ?? '',
      nickname: p.nickname as string,
      email: '',
      avatar_url: (p.avatar_url as string) ?? undefined,
      status: ((p.is_online as boolean) ? 'online' : 'offline') as User['status'],
      created_at: (p.created_at as string) ?? undefined,
    }))
  }

  // ==================== 实时消息 ====================

  subscribeToMessages(callback: (message: Message) => void): () => void {
    const supabase = getSupabase()
    const channel = supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as Message
          callback(newMsg)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          // 消息 UPDATE 事件（用于撤回 / 编辑等场景）
          const updatedMsg = payload.new as Message
          callback(updatedMsg)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }

  // ==================== 在线状态（基于数据库持久化 + Realtime） ====================

  async goOnline(): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase.rpc('go_online')
    if (error) {
      // 如果 RPC 函数还未创建（首次部署），退化到直接 UPDATE（依赖 RLS 策略）
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles').update({ is_online: true, updated_at: new Date().toISOString() }).eq('id', user.id)
      }
    }
  }

  async goOffline(): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase.rpc('go_offline')
    if (error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles').update({ is_online: false, updated_at: new Date().toISOString() }).eq('id', user.id)
      }
    }
  }

  subscribeToOnlineStatus(callback: (event: { userId: string; isOnline: boolean }) => void): () => void {
    const supabase = getSupabase()
    const channel = supabase
      .channel('profiles-online-status')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const old = payload.old as Record<string, unknown>
          const newRow = payload.new as Record<string, unknown>
          const userId = newRow.id as string

          // 仅当 is_online 字段变化时回调
          if (old.is_online !== newRow.is_online && userId) {
            callback({
              userId,
              isOnline: newRow.is_online as boolean,
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }
}

// 仅导出类，不导出实例（实例由 services/index.ts 统一管理）
export { SupabaseChatService }