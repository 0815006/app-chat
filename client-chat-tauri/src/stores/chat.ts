import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message, Friend, ChatServiceType } from '../types'
import { chatService } from '../services'
import { useAuthStore } from './auth'
import { toast } from '../utils/toast'
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'

export const useChatStore = defineStore('chat', () => {
  // ========== 状态 ==========
  const messages = ref<Message[]>([])
  const activeFriend = ref<Friend | null>(null)
  const friends = ref<Friend[]>([])
  const isLoading = ref(false)
  const isLoadingFriends = ref(false)
  const currentBackend = ref<ChatServiceType>('supabase')

  /** 添加好友弹窗显示状态（跨组件共享） */
  const showAddFriendDialog = ref(false)

  // ========== 派生状态 ==========

  /** 当前选中好友的 friend_id（视图层便捷访问） */
  const activeFriendId = computed(() => activeFriend.value?.friend_id ?? null)

  /** 在线好友数 */
  const onlineCount = computed(() => friends.value.filter(f => f.online).length)

  /** 未读消息计数表 { friend_id: count } */
  const unreadCounts = computed(() => {
    const counts: Record<string, number> = {}
    friends.value.forEach((f) => {
      counts[f.friend_id] = f.unread_count ?? 0
    })
    return counts
  })

  // 存储取消订阅的函数
  let unsubscribeRealtime: (() => void) | null = null
  let unsubscribeOnlineStatus: (() => void) | null = null

  // ========== 后端切换 ==========

  function switchBackend(target: ChatServiceType) {
    currentBackend.value = target
    // 二期切换 go-chat-server 时，此处可触发 service 重新初始化
  }

  // ========== 好友操作 ==========

  /** 拉取好友列表 */
  async function loadFriends() {
    isLoadingFriends.value = true
    try {
      friends.value = await chatService.fetchFriends()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '获取好友列表失败')
    } finally {
      isLoadingFriends.value = false
    }
  }

  /** 设置当前活跃好友（接受 friendId 字符串或 Friend 对象） */
  async function setActiveFriend(friendOrId: string | Friend) {
    const id = typeof friendOrId === 'string' ? friendOrId : friendOrId.friend_id
    const found = friends.value.find(f => f.friend_id === id) ?? null
    activeFriend.value = found
    if (found) {
      await loadHistory(found.friend_id)
    }
  }

  /** 添加好友 */
  async function addFriend(friendId: string) {
    const friend = await chatService.addFriend(friendId)
    friends.value.push(friend)
  }

  /** 删除好友 */
  async function removeFriend(friendId: string) {
    await chatService.removeFriend(friendId)
    friends.value = friends.value.filter((f) => f.friend_id !== friendId)
    if (activeFriend.value?.friend_id === friendId) {
      activeFriend.value = null
      messages.value = []
    }
  }

  /** 搜索用户 */
  async function searchUsers(query: string) {
    return chatService.searchUsers(query)
  }

  // ========== 消息操作 ==========

  /** 拉取历史消息 */
  async function loadHistory(friendId: string) {
    const authStore = useAuthStore()
    if (!authStore.currentUser) {
      throw new Error('请先登录')
    }
    isLoading.value = true
    try {
      const history = await chatService.fetchHistory(authStore.currentUser.id, friendId)
      messages.value = history

      // 标记未读消息为已读
      const unreadIds = history
        .filter((m) => m.sender_id === friendId && !m.is_read)
        .map((m) => m.id)
      if (unreadIds.length > 0) {
        await chatService.markAsRead(unreadIds)
      }
    } finally {
      isLoading.value = false
    }
  }

  /** 发送文本消息 */
  async function sendMessage(content: string, msgType: Message['msg_type'] = 'text') {
    const authStore = useAuthStore()
    if (!authStore.currentUser || !activeFriend.value) {
      throw new Error('缺少当前用户或选中好友')
    }

    const msg = await chatService.sendMessage({
      content,
      msg_type: msgType,
      sender_id: authStore.currentUser.id,
      receiver_id: activeFriend.value.friend_id,
    }).catch((e) => {
      toast.error(e instanceof Error ? e.message : '发送消息失败')
      throw e
    })

    messages.value.push(msg)
  }

  /** 上传文件并发送消息 */
  async function sendFile(file: File, type: 'image' | 'file' | 'voice') {
    const authStore = useAuthStore()
    if (!authStore.currentUser || !activeFriend.value) {
      throw new Error('缺少当前用户或选中好友')
    }

    // 上传文件获取 URL
    const url = await chatService.uploadFile({
      file,
      userId: authStore.currentUser.id,
      type,
    })

    // 发送带 URL 的消息
    await sendMessage(url, type)
  }

  // ========== 实时监听 ==========

  /**
   * 发送系统原生通知（窗口未聚焦时）
   * 仅当通知权限已授予时发送；权限未授予时静默跳过
   */
  async function sendSystemNotification(msg: Message) {
    try {
      let permitted = await isPermissionGranted()
      if (!permitted) {
        const result = await requestPermission()
        permitted = result === 'granted'
      }
      if (!permitted) return

      // 仅对方发来的消息才通知，自己发的跳过
      const authStore = useAuthStore()
      if (!authStore.currentUser || msg.sender_id === authStore.currentUser.id) return

      const friend = friends.value.find(
        (f) => f.friend_id === msg.sender_id
      )
      sendNotification({
        title: friend?.name ?? '新消息',
        body: msg.msg_type === 'text'
          ? (msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content)
          : `[${msg.msg_type === 'image' ? '图片' : msg.msg_type === 'voice' ? '语音' : '文件'}]`,
      })
    } catch {
      // Tauri notification API 在非 Tauri 环境（浏览器开发）会报错，静默忽略
    }
  }

  /** 标记当前用户上线 */
  async function goOnline() {
    try {
      await chatService.goOnline()
    } catch {
      // 静默失败：在线状态不是关键路径，不应阻塞 UI
    }
  }

  /** 标记当前用户离线 */
  async function goOffline() {
    try {
      await chatService.goOffline()
    } catch {
      // 静默失败
    }
  }

  /** 初始化在线状态监听（订阅 profiles 表 is_online 变更） */
  function initOnlineStatusListener() {
    if (unsubscribeOnlineStatus) {
      return
    }

    unsubscribeOnlineStatus = chatService.subscribeToOnlineStatus(
      (event: { userId: string; isOnline: boolean }) => {
        // 更新对应好友的在线状态
        const index = friends.value.findIndex((f) => f.friend_id === event.userId)
        if (index !== -1 && friends.value[index].online !== event.isOnline) {
          friends.value[index] = { ...friends.value[index], online: event.isOnline }
        }
      }
    )
  }

  /** 取消在线状态订阅 */
  function destroyOnlineStatusListener() {
    if (unsubscribeOnlineStatus) {
      unsubscribeOnlineStatus()
      unsubscribeOnlineStatus = null
    }
  }

  /** 初始化实时消息监听 */
  function initRealtimeListener() {
    if (unsubscribeRealtime) {
      return
    }

    unsubscribeRealtime = chatService.subscribeToMessages((newMsg: Message) => {
      const authStore = useAuthStore()
      if (!authStore.currentUser) return

      // 仅当新消息属于当前聊天时追加
      if (
        activeFriend.value &&
        (newMsg.receiver_id === activeFriend.value.friend_id ||
          newMsg.sender_id === activeFriend.value.friend_id)
      ) {
        // 幂等：防止重复插入相同 id 的消息
        if (!messages.value.some((m) => m.id === newMsg.id)) {
          messages.value.push(newMsg)
        }

        // 对方发来的消息标记为已读
        if (newMsg.sender_id === activeFriend.value.friend_id) {
          chatService.markAsRead([newMsg.id])
        }
      }

      // 更新好友列表的最后一条消息
      const friendIndex = friends.value.findIndex(
        (f) =>
          f.friend_id === newMsg.sender_id ||
          f.friend_id === newMsg.receiver_id
      )
      if (friendIndex !== -1) {
        friends.value[friendIndex] = {
          ...friends.value[friendIndex],
          last_message: newMsg.content,
          last_message_at: newMsg.created_at,
        }
        // 将当前好友移到列表顶部
        const f = friends.value.splice(friendIndex, 1)[0]
        friends.value.unshift(f)
      }

      // ===== 系统通知：窗口未聚焦时推送 =====
      if (
        newMsg.sender_id !== authStore.currentUser.id &&
        document.visibilityState !== 'visible'
      ) {
        sendSystemNotification(newMsg)
      }
    })
  }

  /** 取消实时消息订阅 */
  function destroyRealtimeListener() {
    if (unsubscribeRealtime) {
      unsubscribeRealtime()
      unsubscribeRealtime = null
    }
  }

  /** 滚动到聊天底部 */
  async function scrollToBottom(containerEl: HTMLElement) {
    await nextTick()
    containerEl.scrollTop = containerEl.scrollHeight
  }

  return {
    // 状态
    messages,
    activeFriend,
    activeFriendId,
    friends,
    isLoading,
    isLoadingFriends,
    currentBackend,
    showAddFriendDialog,
    // 派生
    onlineCount,
    unreadCounts,
    // 后端切换
    switchBackend,
    // 好友操作
    loadFriends,
    setActiveFriend,
    addFriend,
    removeFriend,
    searchUsers,
    // 消息操作
    loadHistory,
    sendMessage,
    sendFile,
    // 实时监听
    initRealtimeListener,
    destroyRealtimeListener,
    goOnline,
    goOffline,
    initOnlineStatusListener,
    destroyOnlineStatusListener,
    scrollToBottom,
  }
})