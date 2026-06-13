<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import TitleBar from '../../components/TitleBar.vue'
import AddFriendDialog from '../../components/chat/AddFriendDialog.vue'
import CreateGroupDialog from '../../components/chat/CreateGroupDialog.vue'
import GroupMembersPanel from '../../components/chat/GroupMembersPanel.vue'
import UserProfileDialog from '../../components/chat/UserProfileDialog.vue'
import Sidebar from './Sidebar.vue'
import FriendList from './FriendList.vue'
import ChatWindow from './ChatWindow.vue'
import InputArea from './InputArea.vue'

const router = useRouter()
const authStore = useAuthStore()
const chatStore = useChatStore()

/** 前端键盘事件后备（Rust 全局快捷键为主，此处为补） */
function onKeyDown(e: KeyboardEvent) {
  // Escape — 取消当前操作
  if (e.key === 'Escape') {
    if (chatStore.activeFriendId) {
      chatStore.setActiveFriend('')
    } else if (chatStore.activeGroupId) {
      chatStore.setActiveGroup('')
    }
    return
  }

  // Ctrl+N — 新建聊天（聚焦搜索栏）
  if (e.ctrlKey && e.key === 'n') {
    e.preventDefault()
    const input = document.querySelector<HTMLInputElement>('[placeholder="搜索好友..."]')
    input?.focus()
    return
  }

  // Ctrl+F — 搜索好友
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault()
    const input = document.querySelector<HTMLInputElement>('[placeholder="搜索好友..."]')
    input?.focus()
    return
  }
}

onMounted(async () => {
  // 注册键盘事件
  window.addEventListener('keydown', onKeyDown)

  // 尝试恢复会话
  const restored = await authStore.restoreSession()

  if (!restored) {
    router.replace('/login')
    return
  }

  // 标记当前用户上线
  await chatStore.goOnline()

  // 加载好友列表和群组列表
  await Promise.all([
    chatStore.loadFriends(),
    chatStore.loadGroups(),
  ])

  // 初始化实时消息监听
  chatStore.initRealtimeListener()

  // 初始化在线状态监听（订阅 profiles 表 is_online 变更）
  chatStore.initOnlineStatusListener()

  // 初始化群成员实时感知（被邀请进群时自动刷新群列表）
  chatStore.initGroupMembersListener()

  // 初始化群组更新实时同步（群名修改时所有成员实时感知）
  chatStore.initGroupUpdateListener()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  // 标记离线（浏览器关闭/页面离开）
  chatStore.goOffline()
  chatStore.destroyRealtimeListener()
  chatStore.destroyOnlineStatusListener()
  chatStore.destroyGroupMembersListener()
  chatStore.destroyGroupUpdateListener()
})
</script>

<template>
  <div class="h-dvh w-full flex flex-col overflow-hidden bg-[#1a1a2e]">
    <!-- 自定义标题栏 -->
    <TitleBar />

    <!-- 聊天主网格 -->
    <div class="flex-1 grid grid-cols-[64px_280px_1fr] grid-rows-[1fr_68px] overflow-hidden">
      <Sidebar class="row-span-2" />
      <FriendList />
      <ChatWindow />
      <InputArea />
    </div>

    <!-- 添加好友弹窗（由 store.showAddFriendDialog 控制，Sidebar / FriendList 均可触发） -->
    <AddFriendDialog
      :visible="chatStore.showAddFriendDialog"
      @close="chatStore.showAddFriendDialog = false"
    />

    <!-- 创建群组弹窗（由 Sidebar 建群按钮触发） -->
    <CreateGroupDialog
      :visible="chatStore.showCreateGroupDialog"
      @close="chatStore.showCreateGroupDialog = false"
    />

    <!-- 群成员面板（由 ChatWindow 群设置按钮触发） -->
    <GroupMembersPanel
      :visible="chatStore.showGroupMembersPanel"
      @close="chatStore.showGroupMembersPanel = false"
    />

    <!-- 个人信息弹窗（由 authStore.showProfileDialog 控制，点击头像触发） -->
    <UserProfileDialog
      :visible="authStore.showProfileDialog"
      @close="authStore.showProfileDialog = false"
    />
  </div>
</template>
