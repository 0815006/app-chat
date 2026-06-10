import { getSupabase } from '../utils/supabase'
import type {
  IChatService,
  LoginParams,
  RegisterParams,
  Message,
  SendMessageParams,
  UploadParams,
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

  async fetchHistory(senderId: string, receiverId: string): Promise<Message[]> {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${senderId},receiver_id.eq.${receiverId}),` +
        `and(sender_id.eq.${receiverId},receiver_id.eq.${senderId})`
      )
      .order('created_at', { ascending: true })
      .limit(100)

    if (error) {
      throw new Error(`获取历史消息失败: ${error.message}`)
    }

    return (data ?? []) as Message[]
  }

  async sendMessage(msgData: SendMessageParams): Promise<Message> {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('messages')
      .insert({
        content: msgData.content,
        msg_type: msgData.msg_type,
        sender_id: msgData.sender_id,
        receiver_id: msgData.receiver_id,
      })
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

  // ==================== 文件上传 ====================

  async uploadFile(params: UploadParams): Promise<string> {
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
      throw new Error(`文件上传失败: ${error.message}`)
    }

    // 获取公开访问 URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName)

    return urlData.publicUrl
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
          avatar_url
        )
      `)
      .eq('user_id', user.id)

    if (error) {
      throw new Error(`获取好友列表失败: ${error.message}`)
    }

    // 同时获取每个好友的最后一条消息
    const result: Friend[] = await Promise.all(
      (data ?? []).map(async (row: any) => {
        const friendProfile = Array.isArray(row.friend) ? row.friend[0] : row.friend
        const friendId = row.friend_id as string

        // 获取最后一条消息
        const { data: lastMsgs } = await supabase
          .from('messages')
          .select('content, created_at')
          .or(
            `and(sender_id.eq.${user.id},receiver_id.eq.${friendId}),` +
            `and(sender_id.eq.${friendId},receiver_id.eq.${user.id})`
          )
          .order('created_at', { ascending: false })
          .limit(1)

        const lastMsg = lastMsgs?.[0]

        return {
          id: row.id,
          friend_id: friendId,
          name: friendProfile?.nickname ?? '未知用户',
          employee_id: friendProfile?.employee_id ?? '',
          avatar_url: friendProfile?.avatar_url ?? undefined,
          online: false,
          last_message: lastMsg?.content,
          last_message_at: lastMsg?.created_at,
          unread_count: 0,
        }
      })
    )

    return result
  }

  async addFriend(friendId: string): Promise<Friend> {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('未登录')
    }

    // 双向插入好友关系
    const { error: err1 } = await supabase.from('friendships').insert({
      user_id: user.id,
      friend_id: friendId,
    })

    if (err1) {
      throw new Error(`添加好友失败: ${err1.message}`)
    }

    const { error: err2 } = await supabase.from('friendships').insert({
      user_id: friendId,
      friend_id: user.id,
    })

    if (err2) {
      // 回滚第一条
      await supabase.from('friendships').delete().eq('user_id', user.id).eq('friend_id', friendId)
      throw new Error(`添加好友失败: ${err2.message}`)
    }

    // 获取好友信息
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', friendId)
      .single()

    return {
      id: '',
      friend_id: friendId,
      name: profile?.nickname ?? '未知用户',
      employee_id: profile?.employee_id ?? '',
      avatar_url: profile?.avatar_url ?? undefined,
      online: false,
    }
  }

  async removeFriend(friendId: string): Promise<void> {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('未登录')
    }

    // 双向删除
    await supabase.from('friendships').delete().eq('user_id', user.id).eq('friend_id', friendId)
    await supabase.from('friendships').delete().eq('user_id', friendId).eq('friend_id', user.id)
  }

  async searchUsers(query: string): Promise<User[]> {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(`nickname.ilike.%${query}%,employee_id.ilike.%${query}%`)
      .limit(20)

    if (error) {
      throw new Error(`搜索用户失败: ${error.message}`)
    }

    return (data ?? []).map((p: any) => ({
      id: p.id,
      employee_id: p.employee_id ?? '',
      nickname: p.nickname,
      email: '',
      avatar_url: p.avatar_url ?? undefined,
      status: 'offline',
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }
}

// 导出单例
export const chatService: IChatService & {
  subscribeToMessages(callback: (message: Message) => void): () => void
} = new SupabaseChatService()