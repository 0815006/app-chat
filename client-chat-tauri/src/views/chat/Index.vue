<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import Sidebar from './Sidebar.vue'
import FriendList from './FriendList.vue'
import ChatWindow from './ChatWindow.vue'
import InputArea from './InputArea.vue'

const router = useRouter()
const authStore = useAuthStore()
const chatStore = useChatStore()

onMounted(async () => {
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
  chatStore.destroyRealtimeListener()
})
</script>

<template>
  <div class="grid grid-cols-[64px_280px_1fr] grid-rows-[1fr_68px] h-dvh w-full overflow-hidden bg-[#1a1a2e]">
    <Sidebar />
    <FriendList />
    <ChatWindow />
    <InputArea />
  </div>
</template>