import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message, Friend, UserSortField, ChatServiceType } from '../types'
import { chatService } from '../services'
import { useAuthStore } from './auth'
import { toast } from '../utils/toast'
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { invoke } from '@tauri-apps/api/core'

/** 每次分页拉取的消息条数 */
const PAGE_SIZE = 20

export const useChatStore = defineStore('chat', () => {
  // ========== 状态 ==========
  const messages = ref<Message[]>([])
  const activeFriend = ref<Friend | null>(null)
  const friends = ref<Friend[]>([])
  const isLoading = ref(false)
  const isLoadingFriends = ref(false)
  const currentBackend = ref<ChatServiceType>('supabase')

  /** 历史消息是否还有更多（用于上拉加载） */
  const hasMore = ref(false)
  /** 正在加载更多历史消息 */
  const isLoadingMore = ref(false)

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
      // 打开聊天框时清除该好友的未读计数
      found.unread_count = 0
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
      hasMore.value = false
    }
  }

  /** 搜索用户 */
  async function searchUsers(query: string) {
    return chatService.searchUsers(query)
  }

  /** 获取所有注册用户 */
  async function fetchAllUsers(sort?: UserSortField) {
    return chatService.fetchAllUsers(sort)
  }

  // ========== 消息操作 ==========

  /** 拉取第一页历史消息（切换好友时调用） */
  async function loadHistory(friendId: string) {
    const authStore = useAuthStore()
    if (!authStore.currentUser) {
      throw new Error('请先登录')
    }
    isLoading.value = true
    hasMore.value = false
    try {
      const [history, more] = await chatService.fetchHistory(
        authStore.currentUser.id,
        friendId,
        PAGE_SIZE
      )

      // 撤回消息处理：
      // 1. 接收者侧：过滤掉已撤回的消息（不显示）
      // 2. 发送者侧：保留，但替换为 "你撤回了一条消息"
      const filtered: Message[] = []
      for (const m of history) {
        if (m.is_revoked) {
          if (m.sender_id === authStore.currentUser.id) {
            m.content = '你撤回了一条消息'
            filtered.push(m)
          }
          // else: 接收者侧直接丢弃
        } else {
          filtered.push(m)
        }
      }

      messages.value = filtered
      hasMore.value = more

      // 标记对方发来的未读消息为已读
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

  /** 加载更早的历史消息（滚动到顶部触发） */
  async function loadMoreHistory(): Promise<number> {
    const authStore = useAuthStore()
    if (!authStore.currentUser || !activeFriend.value) return 0
    if (isLoadingMore.value || !hasMore.value || messages.value.length === 0) return 0

    isLoadingMore.value = true

    try {
      // 以当前最早一条消息的 created_at 作为游标
      const oldestMsg = messages.value[0]
      const [olderMsgs, more] = await chatService.fetchHistory(
        authStore.currentUser.id,
        activeFriend.value.friend_id,
        PAGE_SIZE,
        oldestMsg.created_at
      )

      // 撤回消息处理（同 loadHistory 逻辑）
      const filtered: Message[] = []
      for (const m of olderMsgs) {
        if (m.is_revoked) {
          if (m.sender_id === authStore.currentUser.id) {
            m.content = '你撤回了一条消息'
            filtered.push(m)
          }
        } else {
          filtered.push(m)
        }
      }

      if (filtered.length > 0) {
        // 前置插入到消息列表头部
        messages.value = [...filtered, ...messages.value]
      }
      hasMore.value = more

      return filtered.length
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载历史消息失败')
      return 0
    } finally {
      isLoadingMore.value = false
    }
  }

  /** 仅从本地 UI 移除消息（右键“删除”） */
  function deleteMessageLocally(messageId: string) {
    const idx = messages.value.findIndex((m) => m.id === messageId)
    if (idx !== -1) {
      messages.value.splice(idx, 1)
    }
  }

  /** 撤回消息 — 仅发送者本人可调用，对方窗口通过 Realtime UPDATE 同步移除 */
  async function revokeMessage(messageId: string) {
    try {
      await chatService.revokeMessage(messageId)
      toast.success('撤回成功')
      // 发送者侧：本地消息原地替换为 is_revoked 标记（Realtime UPDATE 回来之前先乐观更新）
      const idx = messages.value.findIndex((m) => m.id === messageId)
      if (idx !== -1) {
        messages.value[idx] = {
          ...messages.value[idx],
          is_revoked: true,
          content: '你撤回了一条消息',
          msg_type: 'text',
          file_name: undefined,
          file_size: undefined,
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '撤回失败')
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

    // 上传文件获取 URL + 元数据
    const result = await chatService.uploadFile({
      file,
      userId: authStore.currentUser.id,
      type,
    })

    // 发送带 URL 的消息，同时携带文件名和大小
    const msgData = {
      content: result.url,
      msg_type: type,
      sender_id: authStore.currentUser.id,
      receiver_id: activeFriend.value.friend_id,
      file_name: result.file_name,
      file_size: result.file_size,
    }
    const msg = await chatService.sendMessage(msgData).catch((e) => {
      toast.error(e instanceof Error ? e.message : '发送消息失败')
      throw e
    })

    messages.value.push(msg)
  }

  // ========== 实时监听 ==========

  /**
   * 触发任务栏图标闪烁（窗口最小化或后台时）
   */
  async function flashTaskbar() {
    try {
      await invoke('flash_window')
    } catch {
      // 在非 Tauri 环境（浏览器开发）会报错，静默忽略
    }
  }

  /**
   * 发送系统原生通知 + 任务栏闪烁（窗口未聚焦时）
   * 仅当通知权限已授予时发送；权限未授予时静默跳过
   */
  async function sendSystemNotification(msg: Message) {
    // 闪烁任务栏
    await flashTaskbar()

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

      // 判断是否是当前活跃聊天
      const isCurrentChat =
        activeFriend.value &&
        (newMsg.receiver_id === activeFriend.value.friend_id ||
          newMsg.sender_id === activeFriend.value.friend_id)

      if (isCurrentChat) {
        const existingIdx = messages.value.findIndex((m) => m.id === newMsg.id)

        if (newMsg.is_revoked) {
          if (newMsg.sender_id === authStore.currentUser.id) {
            // 发送者侧：保留消息，标记为已撤回（显示 "你撤回了一条消息"）
            if (existingIdx !== -1) {
              messages.value[existingIdx] = { ...newMsg, content: '你撤回了一条消息' }
            }
          } else {
            // 接收者侧：直接从列表中移除
            if (existingIdx !== -1) {
              messages.value.splice(existingIdx, 1)
            }
          }
        } else if (existingIdx !== -1) {
          // 非撤回的 UPDATE：原地替换
          messages.value[existingIdx] = newMsg
        } else {
          // INSERT 事件：幂等追加
          if (!messages.value.some((m) => m.id === newMsg.id)) {
            messages.value.push(newMsg)
          }
        }

        // 对方发来的 INSERT 消息立即标记为已读；撤回的 UPDATE 不重复标记
        if (existingIdx === -1 && newMsg.sender_id === activeFriend.value!.friend_id) {
          chatService.markAsRead([newMsg.id])
        }
      }

      // 撤回消息更新好友列表最后一条消息摘要
      const friendIndex = friends.value.findIndex(
        (f) =>
          f.friend_id === newMsg.sender_id ||
          f.friend_id === newMsg.receiver_id
      )
      if (friendIndex !== -1) {
        const f = { ...friends.value[friendIndex] }

        if (newMsg.is_revoked) {
          // 撤回：摘要显示为 "[消息已被撤回]"
          f.last_message = '[消息已被撤回]'
          f.last_message_type = 'text' as Message['msg_type']
        } else if (!messages.value.some((m) => m.id === newMsg.id && m.is_revoked)) {
          // 非撤回的新消息才更新摘要
          f.last_message = newMsg.content
          f.last_message_type = newMsg.msg_type
        }
        f.last_message_at = newMsg.created_at

        // 如果不是当前活跃聊天且消息是对方发的，增加未读计数（撤回消息不增加未读）
        if (!isCurrentChat && newMsg.sender_id !== authStore.currentUser.id && !newMsg.is_revoked) {
          f.unread_count = (f.unread_count ?? 0) + 1
        }

        friends.value[friendIndex] = f
        // 将当前好友移到列表顶部
        const moved = friends.value.splice(friendIndex, 1)[0]
        friends.value.unshift(moved)
      }

      // ===== 系统通知：窗口未聚焦时推送（撤回消息不发通知） =====
      if (
        !newMsg.is_revoked &&
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

  /**
   * 重置所有聊天状态（登出时调用）
   * 确保下一个登录用户看到的是干净的聊天界面
   */
  function resetAll() {
    // 先销毁所有实时订阅
    destroyRealtimeListener()
    destroyOnlineStatusListener()

    // 重置状态
    messages.value = []
    activeFriend.value = null
    friends.value = []
    hasMore.value = false
    isLoadingMore.value = false
    isLoading.value = false
    isLoadingFriends.value = false
    showAddFriendDialog.value = false
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
    isLoadingMore,
    hasMore,
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
    fetchAllUsers,
    // 消息操作
    loadHistory,
    loadMoreHistory,
    sendMessage,
    sendFile,
    deleteMessageLocally,
    revokeMessage,
    // 实时监听
    initRealtimeListener,
    destroyRealtimeListener,
    goOnline,
    goOffline,
    initOnlineStatusListener,
    destroyOnlineStatusListener,
    scrollToBottom,
    // 状态重置（登出时清理）
    resetAll,
  }
})
