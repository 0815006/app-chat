<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '../../stores/chat'

const chatStore = useChatStore()
const inputText = ref('')

async function sendMessage() {
  const content = inputText.value.trim()
  if (!content || !chatStore.activeFriendId) return

  inputText.value = ''
  await chatStore.sendMessage(content)
}
</script>

<template>
  <div
    v-if="chatStore.activeFriendId"
    class="col-start-3 px-5 py-3 bg-[#1e1935] border-t border-[#2d3748] flex items-center gap-3"
  >
    <input
      v-model="inputText"
      type="text"
      placeholder="输入消息..."
      maxlength="5000"
      class="flex-1 px-4 py-2.5 rounded-xl border border-[#2d3748] bg-[#17132b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
      @keyup.enter="sendMessage"
    />
    <button
      class="w-11 h-11 rounded-xl border-none bg-gradient-to-br from-blue-400 to-green-400 text-white cursor-pointer flex items-center justify-center shrink-0 transition-opacity duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="!inputText.trim() || !chatStore.activeFriendId"
      @click="sendMessage"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</template>