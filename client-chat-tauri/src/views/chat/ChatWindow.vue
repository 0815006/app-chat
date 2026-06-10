<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'

const authStore = useAuthStore()
const chatStore = useChatStore()
const containerRef = ref<HTMLDivElement>()

// 切换好友 / 新消息时自动滚底
watch(
  () => [chatStore.activeFriendId, chatStore.messages.length] as const,
  async () => {
    await nextTick()
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight
    }
  }
)
</script>

<template>
  <main v-if="chatStore.activeFriendId" class="flex flex-col bg-[#1a1a2e]">
    <!-- 顶栏 -->
    <header class="flex items-center justify-between px-5 py-3.5 border-b border-[#2d3748] bg-[#1e1935] shrink-0">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center text-white text-sm font-semibold">
          {{ (chatStore.activeFriend?.name ?? '?').charAt(0) }}
        </div>
        <div>
          <div class="text-[15px] font-semibold text-[#e2e8f0]">{{ chatStore.activeFriend?.name }}</div>
          <div class="text-[12px] text-[#718096]">
            <template v-if="chatStore.activeFriend?.online">在线</template>
            <template v-else>离线 {{ chatStore.activeFriend?.last_message_at ? '· ' + new Date(chatStore.activeFriend.last_message_at).toLocaleString('zh-CN') : '' }}</template>
          </div>
        </div>
      </div>
    </header>

    <!-- 消息区 -->
    <div ref="containerRef" class="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar flex flex-col gap-0.5">
      <div
        v-for="msg in chatStore.messages"
        :key="msg.id"
        class="flex gap-3 max-w-[75%] mb-0.5"
        :class="msg.sender_id === authStore.currentUser?.id ? 'self-end flex-row-reverse' : 'self-start'"
      >
        <div
          v-if="msg.sender_id !== authStore.currentUser?.id"
          class="w-8 h-8 mt-1 rounded-full bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center text-white text-xs font-semibold shrink-0"
        >
          {{ (chatStore.activeFriend?.name ?? '?').charAt(0) }}
        </div>
        <div>
          <div
            class="px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed break-words"
            :class="msg.sender_id === authStore.currentUser?.id
              ? 'bg-gradient-to-br from-blue-400 to-green-400 text-white rounded-br-md'
              : 'bg-[#1e293b] text-[#e2e8f0] rounded-bl-md'"
          >
            {{ msg.content }}
          </div>
          <div class="text-[10px] text-[#718096] mt-1" :class="msg.sender_id === authStore.currentUser?.id ? 'text-right' : 'text-left'">
            {{ new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- 未选择好友 -->
  <main v-else class="flex items-center justify-center bg-[#1a1a2e]">
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-400 to-green-400 shadow-[0_8px_32px_rgba(66,153,225,0.15)] mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" class="w-12 h-12">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h3 class="text-xl font-semibold text-[#e2e8f0] mb-1">欢迎使用 Chat</h3>
      <p class="text-sm text-[#718096]">从左侧选择一个好友开始聊天</p>
    </div>
  </main>
</template>