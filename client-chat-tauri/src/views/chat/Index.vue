<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import TitleBar from '../../components/TitleBar.vue'
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

  // 加载好友列表
  await chatStore.loadFriends()

  // 初始化实时消息监听
  chatStore.initRealtimeListener()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  chatStore.destroyRealtimeListener()
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
  </div>
</template>
