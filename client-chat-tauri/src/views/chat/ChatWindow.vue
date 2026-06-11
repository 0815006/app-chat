<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import Avatar from '../../components/Avatar.vue'
import type { Message } from '../../types'

const authStore = useAuthStore()
const chatStore = useChatStore()
const containerRef = ref<HTMLDivElement>()

/** 时间分隔线阈值：5 分钟 */
const TIME_GAP_MS = 5 * 60 * 1000

/**
 * 在相邻消息间隔 >5 分钟的位置插入分隔线
 * 返回 "(消息 | 'time-separator')[]"
 */
const displayMessages = computed(() => {
  const result: (Message | { _sep: true; time: Date })[] = []
  const msgs = chatStore.messages

  for (let i = 0; i < msgs.length; i++) {
    const prev = msgs[i - 1]
    const curr = msgs[i]

    if (prev) {
      const gap = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()
      if (gap > TIME_GAP_MS) {
        result.push({ _sep: true, time: new Date(curr.created_at) })
      }
    } else {
      // 第一条消息总是显示时间分隔
      result.push({ _sep: true, time: new Date(curr.created_at) })
    }

    result.push(curr)
  }

  return result
})

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

function isSeparator(item: Message | { _sep: boolean; time: Date }): item is { _sep: true; time: Date } {
  return '_sep' in item
}

function formatSeparatorTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <main v-if="chatStore.activeFriendId" class="flex flex-col bg-[#1a1a2e]">
    <!-- 顶栏 -->
    <header class="flex items-center justify-between px-5 py-3.5 border-b border-[#2d3748] bg-[#1e1935] shrink-0">
      <div class="flex items-center gap-3">
        <Avatar
          :name="chatStore.activeFriend?.name ?? ''"
          :avatar-url="chatStore.activeFriend?.avatar_url"
          :online="chatStore.activeFriend?.online"
          size="sm"
        />
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
      <!-- 加载态 -->
      <div v-if="chatStore.isLoading" class="flex items-center justify-center py-12 text-[#718096] text-sm">
        <span class="w-4 h-4 border-2 border-[#718096]/30 border-t-[#718096] rounded-full animate-spin mr-2"></span>
        加载消息中...
      </div>

      <template v-for="item in displayMessages">
        <!-- 时间分隔线 -->
        <div
          v-if="isSeparator(item)"
          :key="'sep_' + item.time.getTime()"
          class="flex items-center justify-center my-3"
        >
          <div class="bg-[#ffffff0d] text-[#718096] text-[11px] px-3 py-1 rounded-full">
            {{ formatSeparatorTime(item.time) }}
          </div>
        </div>

        <!-- 消息气泡 -->
        <div
          v-else
          :key="item.id"
          class="flex gap-3 max-w-[75%] mb-0.5"
          :class="item.sender_id === authStore.currentUser?.id ? 'self-end flex-row-reverse' : 'self-start'"
        >
          <Avatar
            v-if="item.sender_id !== authStore.currentUser?.id"
            :name="chatStore.activeFriend?.name ?? ''"
            :avatar-url="chatStore.activeFriend?.avatar_url"
            size="sm"
          />
          <div>
            <div
              class="rounded-2xl overflow-hidden"
              :class="item.sender_id === authStore.currentUser?.id
                ? 'bg-gradient-to-br from-blue-400 to-green-400 text-white rounded-br-md'
                : 'bg-[#1e293b] text-[#e2e8f0] rounded-bl-md'"
            >
              <!-- 文本 -->
              <p v-if="item.msg_type === 'text'" class="px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap">{{ item.content }}</p>

              <!-- 图片 -->
              <div v-else-if="item.msg_type === 'image'" class="p-1">
                <img
                  :src="item.content"
                  alt="图片消息"
                  class="max-w-[360px] max-h-[360px] rounded-xl object-cover cursor-pointer"
                  loading="lazy"
                />
              </div>

              <!-- 文件 -->
              <a
                v-else-if="item.msg_type === 'file'"
                :href="item.content"
                target="_blank"
                class="flex items-center gap-3 px-4 py-3 text-[14px] text-inherit no-underline hover:opacity-80 transition-opacity"
                :download="item.content.split('/').pop() ?? 'download'"
              >
                <span class="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
                <span class="truncate">{{ item.content.split('/').pop() ?? '未知文件' }}</span>
              </a>

              <!-- 语音 -->
              <div v-else-if="item.msg_type === 'voice'" class="px-4 py-3 flex items-center gap-3">
                <audio :src="item.content" controls preload="metadata" class="h-9 w-full max-w-[240px]"></audio>
              </div>

              <!-- 降级 -->
              <p v-else class="px-4 py-2.5 text-[14px] leading-relaxed break-words">{{ item.content }}</p>
            </div>
            <div class="text-[10px] text-[#718096] mt-1" :class="item.sender_id === authStore.currentUser?.id ? 'text-right' : 'text-left'">
              {{ new Date(item.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
            </div>
          </div>
        </div>
      </template>
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