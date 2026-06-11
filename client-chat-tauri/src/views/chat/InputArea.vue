<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '../../stores/chat'
import { toast } from '../../utils/toast'

const chatStore = useChatStore()
const inputText = ref('')

/** 隐藏的 file input 引用 */
const fileInputRef = ref<HTMLInputElement>()
/** 正在上传文件（显示加载状态） */
const isUploading = ref(false)

async function sendTextMessage() {
  const content = inputText.value.trim()
  if (!content || !chatStore.activeFriendId) return

  inputText.value = ''
  await chatStore.sendMessage(content)
}

/**
 * 从 <input type="file"> 选择文件
 */
function onUploadClick() {
  fileInputRef.value?.click()
}

/**
 * 用户从文件对话框选择文件后
 */
async function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  await handleFiles(Array.from(files))

  // 清空 input，允许重复选择同一文件
  input.value = ''
}

/**
 * 拖拽放下事件处理
 */
function onDrop(e: DragEvent) {
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    handleFiles(Array.from(e.dataTransfer.files))
  }
}

/**
 * 统一处理文件列表（来自选择或拖拽）
 */
async function handleFiles(files: File[]) {
  if (!chatStore.activeFriendId) {
    toast.warning('请先选择一个好友再发送文件')
    return
  }

  isUploading.value = true
  try {
    for (const file of files) {
      const type = detectFileType(file)
      await chatStore.sendFile(file, type)
    }
  } catch (e) {
    // sendFile 内部已 toast，此处不再重复
  } finally {
    isUploading.value = false
  }
}

/**
 * 根据 MIME 类型推断消息类型
 */
function detectFileType(file: File): 'image' | 'file' | 'voice' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'voice'
  return 'file'
}
</script>

<template>
  <div
    v-if="chatStore.activeFriendId"
    class="col-start-3 px-5 py-3 bg-[#1e1935] border-t border-[#2d3748] flex items-center gap-3"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <!-- 文件上传按钮 -->
    <button
      class="w-10 h-10 rounded-xl border border-[#2d3748] bg-[#17132b] text-[#718096] cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 hover:border-blue-400 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
      title="发送文件 / 图片"
      :disabled="isUploading"
      @click="onUploadClick"
    >
      <!-- 上传中显示 spinner -->
      <span v-if="isUploading" class="w-4 h-4 border-2 border-[#718096]/30 border-t-blue-400 rounded-full animate-spin"></span>
      <!-- 默认显示 ➕ -->
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
        <path d="M12 5v14M5 12h14" stroke-linecap="round" />
      </svg>
    </button>

    <!-- 隐藏文件选择器 -->
    <input
      ref="fileInputRef"
      type="file"
      multiple
      accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z"
      class="hidden"
      @change="onFilesSelected"
    />

    <!-- 文本输入框 -->
    <input
      v-model="inputText"
      type="text"
      placeholder="输入消息...（可直接拖拽文件到此处）"
      maxlength="5000"
      class="flex-1 px-4 py-2.5 rounded-xl border border-[#2d3748] bg-[#17132b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
      :disabled="isUploading"
      @keyup.enter="sendTextMessage"
    />

    <!-- 发送按钮 -->
    <button
      class="w-11 h-11 rounded-xl border-none bg-gradient-to-br from-blue-400 to-green-400 text-white cursor-pointer flex items-center justify-center shrink-0 transition-opacity duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="!inputText.trim() || !chatStore.activeFriendId || isUploading"
      @click="sendTextMessage"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</template>
