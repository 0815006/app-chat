import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message, Friend, Group, GroupMember, ChatTarget, UserSortField, ChatServiceType } from '../types'
import { MENTION_ALL } from '../types'
import { chatService } from '../services'
import { useAuthStore } from './auth'
import { toast } from '../utils/toast'
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { invoke } from '@tauri-apps/api/core'

/** 运行时检测：是否运行在 Tauri 原生环境中 */
const isTauri = !!(window as any).__TAURI_INTERNALS__

/** 每次分页拉取的消息条数 */
const PAGE_SIZE = 20

/** localStorage key 前缀：按用户隔离撤回消息 ID 集合 */
const REVOKED_IDS_KEY_PREFIX = 'chat_revoked_msg_ids_'

export const useChatStore = defineStore('chat', () => {
  // ========== 状态 ==========
  const messages = ref<Message[]>([])
  const activeFriend = ref<Friend | null>(null)
  const activeGroup = ref<Group | null>(null)
  const friends = ref<Friend[]>([])
  const groups = ref<Group[]>([])
  const isLoading = ref(false)
  const isLoadingFriends = ref(false)
  const isLoadingGroups = ref(false)
  const currentBackend = ref<ChatServiceType>('supabase')

  /**
   * 客户端撤回缓存：记录当前用户已成功撤回的消息 ID
   *
   * 作用：当 loadHistory 从服务端重新拉取消息时，若服务端因故未返回 is_revoked=true
   * （Realtime 事件竞态、RLS 策略差异、后端实现差异等），客户端仍能通过此 Set 识别已撤回
   * 的消息，确保"撤回标记不会因切换聊天对象而丢失"。
   */
  const revokedMessageIds = ref<Set<string>>(new Set())

  // ========== 撤回缓存持久化（localStorage） ==========

  function getRevokedIdsKey(): string {
    const authStore = useAuthStore()
    return REVOKED_IDS_KEY_PREFIX + (authStore.currentUser?.id ?? 'anonymous')
  }

  /** 从 localStorage 恢复撤回缓存 */
  function loadRevokedIds() {
    try {
      const stored = localStorage.getItem(getRevokedIdsKey())
      if (stored) {
        const arr = JSON.parse(stored)
        if (Array.isArray(arr)) {
          revokedMessageIds.value = new Set(arr.filter((id): id is string => typeof id === 'string'))
        }
      }
    } catch {
      // localStorage 不可用或数据损坏时静默降级
    }
  }

  /** 将撤回缓存写入 localStorage */
  function saveRevokedIds() {
    try {
      const key = getRevokedIdsKey()
      if (revokedMessageIds.value.size > 0) {
        localStorage.setItem(key, JSON.stringify([...revokedMessageIds.value]))
      } else {
        localStorage.removeItem(key)
      }
    } catch {
      // localStorage 不可用时静默降级
    }
  }

  /** 清除撤回缓存（登出时调用） */
  function clearRevokedIds() {
    revokedMessageIds.value = new Set()
    try {
      localStorage.removeItem(getRevokedIdsKey())
    } catch {
      // 静默
    }
  }

  /** 历史消息是否还有更多（用于上拉加载） */
  const hasMore = ref(false)
  /** 正在加载更多历史消息 */
  const isLoadingMore = ref(false)

  /** 添加好友弹窗显示状态（跨组件共享） */
  const showAddFriendDialog = ref(false)

  /** 创建群组弹窗显示状态（跨组件共享） */
  const showCreateGroupDialog = ref(false)

  /** 群成员面板显示状态 */
  const showGroupMembersPanel = ref(false)

  // ========== 未读浮动气泡 ==========

  /**
   * 当前聊天中第一条未读消息的 ID（用于 scrollIntoView 定位）
   * 在 loadHistory/loadGroupHistory 中设置：取消息数组中最早一条 is_read=false 的消息
   */
  const firstUnreadMessageId = ref<string | null>(null)

  /**
   * 剩余未读消息数 — 基于 messages 数组中 is_read 字段实时计算
   * 只统计对方发来的、未被撤回的消息
   */
  const unreadRemaining = computed(() => {
    const authStore = useAuthStore()
    if (!authStore.currentUser) return 0
    return messages.value.filter(
      (m) => m.sender_id !== authStore.currentUser!.id && !m.is_read && !m.is_revoked
    ).length
  })

  /**
   * 气泡是否可见：有未读定位目标 且 确实还有未读消息
   * 当 @mention 气泡存在时隐藏通用气泡（互斥，避免重叠），参考微信"@提及优先"逻辑
   */
  const showUnreadBubble = computed(() => {
    return firstUnreadMessageId.value !== null && unreadRemaining.value > 0 && mentionMessageIds.value.length === 0
  })

  // ========== @mention 浮动气泡（仅群聊） ==========

  /**
   * 当前群聊中未读 @mention 消息 ID 列表（按 created_at 降序，最新在前）
   * 在 loadGroupHistory 中填充；每次 jumpToNextMention 弹出第一个（最近的）
   */
  const mentionMessageIds = ref<string[]>([])

  /** 未读 @mention 消息数 */
  const unreadMentionCount = computed(() => mentionMessageIds.value.length)

  /** @mention 气泡是否可见：群聊中还有未读 @mention */
  const showMentionBubble = computed(() => unreadMentionCount.value > 0)

  // ========== 派生状态 ==========

  /** 当前活跃的聊天目标（统一好友/群组） */
  const activeChat = computed<ChatTarget | null>(() => {
    if (activeFriend.value) {
      return {
        type: 'friend',
        id: activeFriend.value.friend_id,
        name: activeFriend.value.name,
        avatar_url: activeFriend.value.avatar_url,
        online: activeFriend.value.online,
        last_message_at: activeFriend.value.last_message_at,
      }
    }
    if (activeGroup.value) {
      return {
        type: 'group',
        id: activeGroup.value.id,
        name: activeGroup.value.name,
        avatar_url: activeGroup.value.avatar_url,
      }
    }
    return null
  })

  /** 当前选中好友的 friend_id（视图层便捷访问） */
  const activeFriendId = computed(() => activeFriend.value?.friend_id ?? null)

  /** 当前选中群组的 group_id（视图层便捷访问） */
  const activeGroupId = computed(() => activeGroup.value?.id ?? null)

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
  let unsubscribeGroupMembers: (() => void) | null = null
  let unsubscribeGroupUpdates: (() => void) | null = null
  let unsubscribeFriendships: (() => void) | null = null

  // ========== 后端切换 ==========

  function switchBackend(target: ChatServiceType) {
    currentBackend.value = target
    // 二期切换 go-chat-server 时，此处可触发 service 重新初始化
  }

  // ========== 未读气泡辅助方法 ==========

  /**
   * 计算加载历史消息时应使用的 limit
   * - 未读数 = 0：20（默认）
   * - 未读数 ≤ 20：20（一屏内覆盖）
   * - 未读数 21~80：unreadCount + 10（加少量冗余确保覆盖）
   * - 未读数 > 80：100（上限，避免一次拉太多）
   */
  function calcLoadLimit(unreadCount: number): number {
    if (unreadCount <= 0) return PAGE_SIZE
    if (unreadCount <= 20) return PAGE_SIZE
    if (unreadCount <= 80) return unreadCount + 10
    return 100
  }

  /**
   * 跳转到第一条未读消息（由 ChatWindow 调用）
   * 通过精确计算目标 scrollTop + scrollTo 实现，避免 scrollIntoView 与
   * setTimeout 的竞态导致滚动距离不足。
   */
  function jumpToFirstUnread(containerEl: HTMLElement) {
    if (!firstUnreadMessageId.value) return
    const el = containerEl.querySelector(
      `[data-msg-id="${firstUnreadMessageId.value}"]`
    ) as HTMLElement | null
    if (el) {
      // 精确计算目标滚动位置：元素顶部相对于容器可滚动区域顶部的偏移 - 80px 呼吸空间
      const containerRect = containerEl.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const offsetInViewport = elRect.top - containerRect.top
      const targetScrollTop = containerEl.scrollTop + offsetInViewport - 80
      containerEl.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      })
    } else {
      // fallback：估算位置（约 30% 高度处）
      containerEl.scrollTop = containerEl.scrollHeight * 0.3
    }
  }

  /** 隐藏气泡并清除定位目标 */
  function dismissUnreadBubble() {
    firstUnreadMessageId.value = null
  }

  /** 重置当前聊天未读气泡状态（切换聊天入口统一调用） */
  function resetUnreadBubble() {
    firstUnreadMessageId.value = null
  }

  // ========== @mention 气泡方法 ==========

  /** 跳转到最近一条未读 @mention 消息，然后弹出该 ID；完成后若还有剩余则气泡继续显示 */
  function jumpToNextMention(containerEl: HTMLElement) {
    if (mentionMessageIds.value.length === 0) return

    const targetId = mentionMessageIds.value[0]
    const el = containerEl.querySelector(
      `[data-msg-id="${targetId}"]`
    ) as HTMLElement | null

    if (el) {
      const containerRect = containerEl.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const offsetInViewport = elRect.top - containerRect.top
      const targetScrollTop = containerEl.scrollTop + offsetInViewport - 80
      containerEl.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      })
    } else {
      containerEl.scrollTop = containerEl.scrollHeight * 0.3
    }

    // 弹出第一个（最近一条），剩余的下次点击继续
    mentionMessageIds.value.shift()
  }

  /** 关闭群聊/切换到非群聊时清除 @mention 气泡状态 */
  function dismissMentionBubble() {
    mentionMessageIds.value = []
  }

  // ========== 好友操作 ==========

  /** 拉取好友列表 */
  async function loadFriends() {
    // 首次加载好友时恢复客户端撤回缓存
    loadRevokedIds()

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
    // 先清除群组选中状态，确保 ChatWindow 标题正确切换到好友
    activeGroup.value = null
    const found = friends.value.find(f => f.friend_id === id) ?? null
    activeFriend.value = found
    if (found) {
      // 在清零前保存原始未读数，供 calcLoadLimit 使用
      const unread = found.unread_count ?? 0
      // 重置气泡状态
      resetUnreadBubble()
      dismissMentionBubble()
      // 立即清零前端未读计数（避免 FriendList 角标残留）
      found.unread_count = 0
      await loadHistory(found.friend_id, unread)
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

  // ========== 群组操作 ==========

  /** 拉取群组列表 */
  async function loadGroups() {
    isLoadingGroups.value = true
    try {
      groups.value = await chatService.fetchGroups()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '获取群组列表失败')
    } finally {
      isLoadingGroups.value = false
    }
  }

  /** 设置当前活跃群组 */
  async function setActiveGroup(groupOrId: string | Group) {
    const id = typeof groupOrId === 'string' ? groupOrId : groupOrId.id
    // 先清除好友选中状态
    activeFriend.value = null
    const found = groups.value.find(g => g.id === id) ?? null
    activeGroup.value = found
    if (found) {
      const unread = found.unread_count ?? 0
      resetUnreadBubble()
      dismissMentionBubble()
      found.unread_count = 0
      await loadGroupHistory(found.id, unread)
    }
  }

  /** 创建群组 */
  async function createGroup(name: string, memberIds: string[]) {
    try {
      const group = await chatService.createGroup(name, memberIds)
      groups.value.unshift(group)
      toast.success(`群组「${name}」创建成功`)
      return group
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建群组失败')
      throw e
    }
  }

  /** 拉取群成员列表 */
  async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
    try {
      return await chatService.fetchGroupMembers(groupId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '获取群成员失败')
      return []
    }
  }

  /** 拉人进群 */
  async function addGroupMember(groupId: string, userId: string) {
    try {
      await chatService.addGroupMember(groupId, userId)
      toast.success('已拉入群聊')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉人进群失败')
    }
  }

  /** 踢人/退出群聊 */
  async function removeGroupMember(groupId: string, userId: string) {
    try {
      await chatService.removeGroupMember(groupId, userId)
      const authStore = useAuthStore()
      if (userId === authStore.currentUser?.id) {
        // 自己退群：从本地列表移除
        groups.value = groups.value.filter(g => g.id !== groupId)
        if (activeGroup.value?.id === groupId) {
          activeGroup.value = null
          messages.value = []
          hasMore.value = false
        }
      }
      toast.success(userId === authStore.currentUser?.id ? '已退出群聊' : '已移出群聊')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  /** 解散群组 */
  async function dissolveGroup(groupId: string) {
    try {
      await chatService.dissolveGroup(groupId)
      groups.value = groups.value.filter(g => g.id !== groupId)
      if (activeGroup.value?.id === groupId) {
        activeGroup.value = null
        messages.value = []
        hasMore.value = false
      }
      toast.success('群组已解散')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '解散群组失败')
    }
  }

  /** 修改群名（任何群成员均可执行） */
  async function updateGroupName(groupId: string, name: string) {
    try {
      await chatService.updateGroupName(groupId, name)
      // 更新本地群组缓存
      const idx = groups.value.findIndex(g => g.id === groupId)
      if (idx !== -1) {
        groups.value[idx] = { ...groups.value[idx], name }
      }
      if (activeGroup.value?.id === groupId) {
        activeGroup.value = { ...activeGroup.value, name }
      }
      toast.success('群名已更新')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改群名失败')
      throw e
    }
  }

  // ========== 撤回过滤辅助函数 ==========

  /**
   * 对一组消息执行撤回过滤：
   * - 接收者侧：过滤掉已撤回的消息（不显示）
   * - 发送者侧：保留，但替换为 "你撤回了一条消息"
   * 同时叠加客户端撤回缓存（revokedMessageIds）
   */
  function filterRevoked(history: Message[], myId: string): Message[] {
    const filtered: Message[] = []
    for (const m of history) {
      if (m.is_revoked || revokedMessageIds.value.has(m.id)) {
        if (m.sender_id === myId) {
          m.is_revoked = true
          m.content = '你撤回了一条消息'
          filtered.push(m)
        }
        // else: 接收者侧直接丢弃
      } else {
        filtered.push(m)
      }
    }
    return filtered
  }

  // ========== 消息操作 ==========

  /** 拉取第一页历史消息（切换好友时调用） */
  async function loadHistory(friendId: string, unreadCount: number = 0) {
    const authStore = useAuthStore()
    if (!authStore.currentUser) {
      throw new Error('请先登录')
    }
    isLoading.value = true
    hasMore.value = false

    // 根据未读数决定加载量，确保第一条未读消息在数组中
    const limit = calcLoadLimit(unreadCount)

    try {
      const [history, more] = await chatService.fetchHistory(
        authStore.currentUser.id,
        friendId,
        limit
      )

      const filtered = filterRevoked(history, authStore.currentUser.id)

      messages.value = filtered
      hasMore.value = more

      // 定位第一条未读消息：取数组中最早一条 is_read=false 的对方消息
      if (unreadCount > 0 && filtered.length > 0) {
        const myId = authStore.currentUser.id
        const firstUnread = filtered.find(
          (m) => m.sender_id !== myId && !m.is_read
        )
        if (firstUnread) {
          firstUnreadMessageId.value = firstUnread.id
        }
      }

      // 已读标记不再在此处批量调用；改为 ChatWindow 中 IntersectionObserver 逐条标记
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

      const filtered = filterRevoked(olderMsgs, authStore.currentUser.id)

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

  /** 拉取群组第一页历史消息 */
  async function loadGroupHistory(groupId: string, unreadCount: number = 0) {
    isLoading.value = true
    hasMore.value = false
    const limit = calcLoadLimit(unreadCount)
    try {
      const [history, more] = await chatService.fetchGroupHistory(groupId, limit)

      const authStore = useAuthStore()
      const filtered = filterRevoked(history, authStore.currentUser?.id ?? '')

      messages.value = filtered
      hasMore.value = more

      // 定位第一条未读消息
      if (unreadCount > 0 && filtered.length > 0) {
        const myId = authStore.currentUser?.id ?? ''
        const firstUnread = filtered.find(
          (m) => m.sender_id !== myId && !m.is_read
        )
        if (firstUnread) {
          firstUnreadMessageId.value = firstUnread.id
        }

        // 扫描未读 @mention 消息（按 created_at 降序，最新在前）
        mentionMessageIds.value = filtered
          .filter(
            (m) => m.sender_id !== myId && !m.is_read && !m.is_revoked && isMentioningMe(m, myId)
          )
          .sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          .map((m) => m.id)
      } else {
        mentionMessageIds.value = []
      }

      // 已读标记不再在此处批量调用；改为 ChatWindow 中 IntersectionObserver 逐条标记
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 标记单条消息为已读（由 ChatWindow 中的 IntersectionObserver 逐条调用）
   * 同时乐观更新本地 is_read 状态，使 unreadRemaining computed 实时递减
   */
  async function markMessageAsRead(messageId: string) {
    const authStore = useAuthStore()
    if (!authStore.currentUser) return

    // 先乐观更新本地状态（立即反映在 unreadRemaining computed 中）
    const msg = messages.value.find((m) => m.id === messageId)
    if (!msg || msg.is_read || msg.sender_id === authStore.currentUser.id) return
    msg.is_read = true

    // 如果该消息在 @mention 气泡列表中，移除以保持列表准确反映未读状态
    const mentionIdx = mentionMessageIds.value.indexOf(messageId)
    if (mentionIdx !== -1) {
      mentionMessageIds.value.splice(mentionIdx, 1)
    }

    // 异步通知服务端
    try {
      if (activeGroup.value) {
        await chatService.markGroupMessagesAsRead(activeGroup.value.id, [messageId])
      } else if (activeFriend.value) {
        await chatService.markAsRead([messageId])
      }
    } catch {
      // 网络失败时回滚本地状态
      msg.is_read = false
    }
  }

  /** 加载更早的群组历史消息 */
  async function loadMoreGroupHistory(): Promise<number> {
    if (!activeGroup.value) return 0
    if (isLoadingMore.value || !hasMore.value || messages.value.length === 0) return 0

    isLoadingMore.value = true

    try {
      const oldestMsg = messages.value[0]
      const [olderMsgs, more] = await chatService.fetchGroupHistory(
        activeGroup.value.id,
        PAGE_SIZE,
        oldestMsg.created_at
      )

      const authStore = useAuthStore()
      const filtered = filterRevoked(olderMsgs, authStore.currentUser?.id ?? '')

      if (filtered.length > 0) {
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

  /** 仅从本地 UI 移除消息（右键"删除"） */
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

      // 写入客户端撤回缓存（防止切换聊天对象后 loadHistory 重新拉取时丢失撤回标记）
      revokedMessageIds.value.add(messageId)
      saveRevokedIds()

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
  async function sendMessage(content: string, msgType: Message['msg_type'] = 'text', mentionIds?: string[]) {
    const authStore = useAuthStore()
    if (!authStore.currentUser) {
      throw new Error('缺少当前用户')
    }

    const msgData: {
      content: string
      msg_type: Message['msg_type']
      sender_id: string
      receiver_id: string
      group_id?: string
      mention_ids?: string[]
    } = {
      content,
      msg_type: msgType,
      sender_id: authStore.currentUser.id,
      receiver_id: '',
    }

    // 群聊 @mention
    if (activeGroup.value && mentionIds && mentionIds.length > 0) {
      msgData.mention_ids = mentionIds
    }

    if (activeGroup.value) {
      // 群消息：receiver_id 填发送者自己（满足 FK 约束），group_id 标识真正的群
      msgData.receiver_id = authStore.currentUser.id
      msgData.group_id = activeGroup.value.id
    } else if (activeFriend.value) {
      msgData.receiver_id = activeFriend.value.friend_id
    } else {
      throw new Error('请先选择好友或群组')
    }

    const msg = await chatService.sendMessage(msgData).catch((e) => {
      toast.error(e instanceof Error ? e.message : '发送消息失败')
      throw e
    })

    messages.value.push(msg)
  }

  /** 上传文件并发送消息 */
  async function sendFile(file: File, type: 'image' | 'file' | 'voice') {
    const authStore = useAuthStore()
    if (!authStore.currentUser) {
      throw new Error('缺少当前用户')
    }

    // 上传文件获取 URL + 元数据
    const result = await chatService.uploadFile({
      file,
      userId: authStore.currentUser.id,
      type,
    })

    // 发送带 URL 的消息，同时携带文件名和大小
    const msgData: {
      content: string
      msg_type: 'image' | 'file' | 'voice'
      sender_id: string
      receiver_id: string
      file_name?: string
      file_size?: number
      group_id?: string
    } = {
      content: result.url,
      msg_type: type,
      sender_id: authStore.currentUser.id,
      receiver_id: '',
      file_name: result.file_name,
      file_size: result.file_size,
    }

    if (activeGroup.value) {
      msgData.receiver_id = authStore.currentUser.id
      msgData.group_id = activeGroup.value.id
    } else if (activeFriend.value) {
      msgData.receiver_id = activeFriend.value.friend_id
    } else {
      throw new Error('请先选择好友或群组')
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
   * 仅 Tauri 环境有效
   */
  async function flashTaskbar() {
    if (!isTauri) return
    try {
      await invoke('flash_window')
    } catch {
      // 静默忽略
    }
  }

  /**
   * 发送系统原生通知 + 任务栏闪烁（窗口未聚焦时）
   * Tauri 环境：调用 @tauri-apps/plugin-notification
   * Web 环境：使用浏览器 Notification API
   */

  /** 判断一条消息是否 @ 了当前用户（含 @所有人） */
  function isMentioningMe(msg: Message, myId: string): boolean {
    if (!msg.mention_ids || msg.mention_ids.length === 0) return false
    return msg.mention_ids.includes(MENTION_ALL) || msg.mention_ids.includes(myId)
  }

  async function sendSystemNotification(msg: Message) {
    // 闪烁任务栏（Tauri only）
    await flashTaskbar()

    // 仅对方发来的消息才通知，自己发的跳过
    const authStore = useAuthStore()
    if (!authStore.currentUser || msg.sender_id === authStore.currentUser.id) return

    // 构建通知标题：群消息显示"群名 — 发送者"，单聊显示好友名
    let title = '新消息'
    if (msg.group_id) {
      const group = groups.value.find(g => g.id === msg.group_id)
      const friend = friends.value.find(f => f.friend_id === msg.sender_id)
      const senderName = friend?.name ?? '群成员'
      title = group ? `${group.name} — ${senderName}` : `群聊 — ${senderName}`
    } else {
      const friend = friends.value.find(f => f.friend_id === msg.sender_id)
      title = friend?.name ?? '新消息'
    }

    // 被 @ 时标题前缀 [有人@我]
    if (isMentioningMe(msg, authStore.currentUser.id)) {
      title = `[有人@我] ${title}`
    }

    const body = msg.msg_type === 'text'
      ? (msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content)
      : `[${msg.msg_type === 'image' ? '图片' : msg.msg_type === 'voice' ? '语音' : '文件'}]`

    if (isTauri) {
      // Tauri 原生通知
      try {
        let permitted = await isPermissionGranted()
        if (!permitted) {
          const result = await requestPermission()
          permitted = result === 'granted'
        }
        if (!permitted) return

        sendNotification({ title, body })
      } catch {
        // 静默忽略
      }
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      // 浏览器 Notification API 降级
      try {
        if (Notification.permission === 'granted') {
          new Notification(title, { body, icon: '/favicon.svg' })
        } else if (Notification.permission !== 'denied') {
          const result = await Notification.requestPermission()
          if (result === 'granted') {
            new Notification(title, { body, icon: '/favicon.svg' })
          }
        }
      } catch {
        // 静默忽略
      }
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

      // 判断是否是当前活跃聊天（好友或群组）
      const isCurrentFriendChat =
        activeFriend.value &&
        !newMsg.group_id &&
        (newMsg.receiver_id === activeFriend.value.friend_id ||
          newMsg.sender_id === activeFriend.value.friend_id)

      const isCurrentGroupChat =
        activeGroup.value &&
        !!newMsg.group_id &&
        newMsg.group_id === activeGroup.value.id

      const isCurrentChat = isCurrentFriendChat || isCurrentGroupChat

      if (isCurrentChat) {
        const existingIdx = messages.value.findIndex((m) => m.id === newMsg.id)

        if (newMsg.is_revoked) {
          // 同步到客户端撤回缓存（多端/多标签页场景下，其他客户端撤回也能缓存）
          if (newMsg.sender_id === authStore.currentUser.id) {
            revokedMessageIds.value.add(newMsg.id)
            saveRevokedIds()
            // 发送者侧：保留消息，标记为已撤回（显示 "你撤回了一条消息"）
            if (existingIdx !== -1) {
              messages.value[existingIdx] = { ...newMsg, content: '你撤回了一条消息' }
            }
          } else {
            // 接收者侧：直接从列表中移除，同时写入客户端撤回缓存
            // 防止切换聊天对象后重新加载历史时因服务端数据延迟导致消息复现
            revokedMessageIds.value.add(newMsg.id)
            saveRevokedIds()
            if (existingIdx !== -1) {
              messages.value.splice(existingIdx, 1)
            }
          }
          // 撤回后检查是否还有未读消息，无未读则清空气泡定位
          if (existingIdx !== -1 && firstUnreadMessageId.value === newMsg.id) {
            // 第一条未读被撤回了，重新定位
            const myId = authStore.currentUser.id
            const nextUnread = messages.value.find(
              (m) => m.sender_id !== myId && !m.is_read && !m.is_revoked
            )
            firstUnreadMessageId.value = nextUnread?.id ?? null
          }
        } else if (existingIdx !== -1) {
          // 非撤回的 UPDATE：原地替换
          messages.value[existingIdx] = newMsg
        } else {
          // INSERT 事件：幂等追加
          if (!messages.value.some((m) => m.id === newMsg.id)) {
            // Go 后端 WebSocket 回显：替换发送者自己的临时占位消息（id 为空），避免重复
            const tempIdx = messages.value.findIndex(
              (m) => m.id === '' && m.sender_id === newMsg.sender_id && m.content === newMsg.content
            )
            if (tempIdx !== -1) {
              messages.value[tempIdx] = newMsg
            } else {
              messages.value.push(newMsg)
            }
          }
        }

        // 对方发来的 INSERT 消息立即标记为已读
        if (existingIdx === -1 && newMsg.sender_id !== authStore.currentUser.id) {
          if (isCurrentGroupChat) {
            chatService.markGroupMessagesAsRead(activeGroup.value!.id, [newMsg.id])
          } else if (isCurrentFriendChat) {
            chatService.markAsRead([newMsg.id])
          }
        }
        // 注意：unreadRemaining 是 computed，基于 messages 中 is_read 字段自动计算
        // showUnreadBubble 也是 computed，基于 firstUnreadMessageId + unreadRemaining
        // mentionMessageIds 由 loadGroupHistory 填充（进入群聊时扫描未读消息）；
        // 当前正在群聊中收到的新 @mention 消息立即可见，不加入气泡列表
      }

      // ===== 非群消息：更新好友列表摘要 =====
      if (!newMsg.group_id) {
        const friendIndex = friends.value.findIndex(
          (f) =>
            f.friend_id === newMsg.sender_id ||
            f.friend_id === newMsg.receiver_id
        )
        if (friendIndex !== -1) {
          const f = { ...friends.value[friendIndex] }

          if (newMsg.is_revoked) {
            f.last_message = newMsg.sender_id === authStore.currentUser.id
              ? '你撤回了一条消息'
              : '[消息已被撤回]'
            f.last_message_type = 'text' as Message['msg_type']
          } else if (!messages.value.some((m) => m.id === newMsg.id && m.is_revoked)) {
            f.last_message = newMsg.content
            f.last_message_type = newMsg.msg_type
          }
          f.last_message_at = newMsg.created_at

          if (!isCurrentChat && newMsg.sender_id !== authStore.currentUser.id && !newMsg.is_revoked) {
            f.unread_count = (f.unread_count ?? 0) + 1
          }

          friends.value[friendIndex] = f
          // 将当前好友移到列表顶部
          const moved = friends.value.splice(friendIndex, 1)[0]
          friends.value.unshift(moved)
        }
      }

      // ===== 群消息：更新群组列表摘要 =====
      if (newMsg.group_id) {
        const groupIndex = groups.value.findIndex(g => g.id === newMsg.group_id)
        if (groupIndex !== -1) {
          const g = { ...groups.value[groupIndex] }

          if (newMsg.is_revoked) {
            g.last_message = newMsg.sender_id === authStore.currentUser.id
              ? '你撤回了一条消息'
              : '[消息已被撤回]'
            g.last_message_type = 'text' as Message['msg_type']
          } else if (!messages.value.some((m) => m.id === newMsg.id && m.is_revoked)) {
            // 被 @ 时摘要前缀 [有人@我]
            if (isMentioningMe(newMsg, authStore.currentUser.id)) {
              g.last_message = '[有人@我] ' + newMsg.content
            } else {
              g.last_message = newMsg.content
            }
            g.last_message_type = newMsg.msg_type
          }
          g.last_message_at = newMsg.created_at

          if (!isCurrentChat && newMsg.sender_id !== authStore.currentUser.id && !newMsg.is_revoked) {
            g.unread_count = (g.unread_count ?? 0) + 1
          }

          groups.value[groupIndex] = g
          // 将当前群组移到列表顶部
          const movedGroup = groups.value.splice(groupIndex, 1)[0]
          groups.value.unshift(movedGroup)
        }
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

  /** 初始化群成员实时感知（被邀请进群时自动刷新群列表） */
  function initGroupMembersListener() {
    if (unsubscribeGroupMembers) {
      return
    }

    const authStore = useAuthStore()

    unsubscribeGroupMembers = chatService.subscribeToGroupMembers(
      (event: { groupId: string; userId: string }) => {
        // 仅当被邀请的成员是自己时才刷新群列表
        if (event.userId === authStore.currentUser?.id) {
          loadGroups()
        }
      }
    )
  }

  /** 取消群成员实时感知订阅 */
  function destroyGroupMembersListener() {
    if (unsubscribeGroupMembers) {
      unsubscribeGroupMembers()
      unsubscribeGroupMembers = null
    }
  }

  /** 初始化群组更新实时同步（群名修改时所有成员实时感知） */
  function initGroupUpdateListener() {
    if (unsubscribeGroupUpdates) {
      return
    }

    unsubscribeGroupUpdates = chatService.subscribeToGroupUpdates(
      (event: { groupId: string; name: string; avatar_url: string }) => {
        // 同步 groups 列表中对应群组的信息
        const idx = groups.value.findIndex(g => g.id === event.groupId)
        if (idx !== -1) {
          groups.value[idx] = {
            ...groups.value[idx],
            name: event.name,
            avatar_url: event.avatar_url,
          }
        }
        // 如果当前正在查看该群组，同步更新 activeGroup
        if (activeGroup.value?.id === event.groupId) {
          activeGroup.value = {
            ...activeGroup.value,
            name: event.name,
            avatar_url: event.avatar_url,
          }
        }
      }
    )
  }

  /** 取消群组更新实时同步订阅 */
  function destroyGroupUpdateListener() {
    if (unsubscribeGroupUpdates) {
      unsubscribeGroupUpdates()
      unsubscribeGroupUpdates = null
    }
  }

  /** 初始化好友关系实时感知（被别人添加为好友时自动刷新列表） */
  function initFriendshipListener() {
    if (unsubscribeFriendships) {
      return
    }

    const authStore = useAuthStore()

    unsubscribeFriendships = chatService.subscribeToFriendships(
      (event: { userId: string; friendId: string }) => {
        // 仅当被添加的好友是自己时才刷新好友列表
        if (event.userId === authStore.currentUser?.id) {
          loadFriends()
        }
      }
    )
  }

  /** 取消好友关系实时感知订阅 */
  function destroyFriendshipListener() {
    if (unsubscribeFriendships) {
      unsubscribeFriendships()
      unsubscribeFriendships = null
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
    destroyGroupMembersListener()
    destroyGroupUpdateListener()
    destroyFriendshipListener()

    // 清除客户端撤回缓存
    clearRevokedIds()

    // 重置状态
    messages.value = []
    activeFriend.value = null
    activeGroup.value = null
    friends.value = []
    groups.value = []
    hasMore.value = false
    isLoadingMore.value = false
    isLoading.value = false
    isLoadingFriends.value = false
    isLoadingGroups.value = false
    showAddFriendDialog.value = false
    showCreateGroupDialog.value = false
    showGroupMembersPanel.value = false

    // 重置未读气泡状态
    firstUnreadMessageId.value = null
    mentionMessageIds.value = []
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
    activeGroup,
    activeGroupId,
    activeChat,
    friends,
    groups,
    isLoading,
    isLoadingFriends,
    isLoadingGroups,
    isLoadingMore,
    hasMore,
    currentBackend,
    showAddFriendDialog,
    showCreateGroupDialog,
    showGroupMembersPanel,
    // 未读浮动气泡
    unreadRemaining,
    firstUnreadMessageId,
    showUnreadBubble,
    jumpToFirstUnread,
    dismissUnreadBubble,
    // @mention 浮动气泡（仅群聊）
    mentionMessageIds,
    unreadMentionCount,
    showMentionBubble,
    jumpToNextMention,
    dismissMentionBubble,
    markMessageAsRead,
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
    // 群组操作
    loadGroups,
    setActiveGroup,
    createGroup,
    fetchGroupMembers,
    addGroupMember,
    removeGroupMember,
    dissolveGroup,
    updateGroupName,
    // 消息操作
    loadHistory,
    loadMoreHistory,
    loadGroupHistory,
    loadMoreGroupHistory,
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
    // 群成员实时感知
    initGroupMembersListener,
    destroyGroupMembersListener,
    // 群组更新实时同步
    initGroupUpdateListener,
    destroyGroupUpdateListener,
    // 好友关系实时感知
    initFriendshipListener,
    destroyFriendshipListener,
    // 状态重置（登出时清理）
    resetAll,
  }
})
