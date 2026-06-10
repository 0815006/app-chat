import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message, Friend, ChatServiceType } from '../types'
import { chatService } from '../services/chatService'
import { useAuthStore } from './auth'

export const useChatStore = defineStore('chat', () => {
  // ========== 状态 ==========
  const messages = ref<Message[]>([])
  const activeFriend = ref<Friend | null>(null)
  const friends = ref<Friend[]>([])
  const isLoading = ref(false)
  const isLoadingFriends = ref(false)
  const currentBackend = ref<ChatServiceType>('supabase')

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
      console.error('获取好友列表失败:', e)
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
        messages.value.push(newMsg)

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
    scrollToBottom,
  }
})