<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../utils/toast'
import { MENTION_ALL } from '../../types'
import type { GroupMember } from '../../types'
import MentionSelector from '../../components/chat/MentionSelector.vue'

const chatStore = useChatStore()
const authStore = useAuthStore()
const inputText = ref('')

/** 隐藏的 file input 引用 */
const fileInputRef = ref<HTMLInputElement>()
/** 正在上传文件（显示加载状态） */
const isUploading = ref(false)

// ========== @mention 状态 ==========

/** MentionSelector 引用 */
const mentionSelectorRef = ref<InstanceType<typeof MentionSelector>>()

/** 是否正在 @ 选择中 */
const mentionActive = ref(false)
/** @ 符号在 inputText 中的起始位置（0-indexed） */
const mentionStartIndex = ref(-1)
/** @ 后面输入的关键词 */
const mentionKeyword = computed(() => {
  if (!mentionActive.value || mentionStartIndex.value < 0) return ''
  return inputText.value.substring(mentionStartIndex.value + 1)
})

/** 群成员列表（从 store 缓存加载） */
const groupMembers = ref<GroupMember[]>([])

/** 是否是群聊输入 */
const isGroupChat = computed(() => chatStore.activeGroupId !== null)

/** 选择器可见条件：群聊 + @ 激活 + 有成员数据 */
const selectorVisible = computed(() => {
  return isGroupChat.value && mentionActive.value
})

/**
 * 从输入文本中提取所有 @mention 的 mention_ids
 * 支持：多 @、@所有人、混合文本
 */
function extractMentions(text: string, members: GroupMember[]): string[] {
  const mentionIds: string[] = []

  // 先检查 @所有人
  if (/@所有人\b/.test(text)) {
    mentionIds.push(MENTION_ALL)
  }

  // 提取所有 @具体成员（/g 标志匹配全文中的所有 @xxx 出现位置）
  const mentionRegex = /@(\S+)/g
  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1]
    if (name === '所有人') continue // 已处理
    const member = members.find(m => m.nickname === name)
    if (member && !mentionIds.includes(member.user_id)) {
      mentionIds.push(member.user_id)
    }
  }
  return mentionIds
}

async function sendTextMessage() {
  const content = inputText.value.trim()
  const hasTarget = chatStore.activeFriendId !== null || chatStore.activeGroupId !== null
  if (!content || !hasTarget) return

  inputText.value = ''

  // 群聊：提取 mention_ids
  let mentionIds: string[] | undefined
  if (isGroupChat.value) {
    mentionIds = extractMentions(content, groupMembers.value)
    if (mentionIds.length === 0) mentionIds = undefined
  }

  await chatStore.sendMessage(content, 'text', mentionIds)
}

// ========== @ 触发逻辑 ==========

/**
 * 监听 inputText 变化，检测 @ 输入
 * 策略：查找光标前的最后一个 @ 符号
 */
function onInput(e: Event) {
  const input = e.target as HTMLInputElement
  const cursorPos = input.selectionStart ?? 0
  const text = inputText.value

  // 查找光标前的最后一个 @
  const atIndex = text.lastIndexOf('@', cursorPos - 1)

  if (atIndex !== -1 && isGroupChat.value) {
    // 确保 @ 是独立的（前面是空白或开头）
    const charBefore = atIndex === 0 ? ' ' : text[atIndex - 1]
    const isValidAt = atIndex === 0 || charBefore === ' ' || charBefore === '\n'

    // 光标必须在 @ 之后、且 @ 之后没有空格（表示正在输入关键词）
    const afterAt = text.substring(atIndex + 1, cursorPos)
    const hasSpaceAfter = afterAt.includes(' ')

    if (isValidAt && !hasSpaceAfter) {
      mentionStartIndex.value = atIndex
      mentionActive.value = true
      // 确保成员列表已加载
      loadGroupMembersIfNeeded()
      return
    }
  }

  // 没找到有效 @ → 关闭选择器
  closeMentionSelector()
}

/** 异步加载群成员（优先缓存） */
async function loadGroupMembersIfNeeded() {
  if (!chatStore.activeGroupId) return
  if (groupMembers.value.length > 0) return // 已缓存

  try {
    const members = await chatStore.fetchGroupMembers(chatStore.activeGroupId)
    groupMembers.value = members
  } catch {
    // 静默失败，选择器内会显示"加载中"
  }
}

function closeMentionSelector() {
  mentionActive.value = false
  mentionStartIndex.value = -1
}

/**
 * 用户选择了某个成员（或 @所有人）
 */
function onMentionSelect(memberOrAll: GroupMember | '@all') {
  if (mentionStartIndex.value < 0) return

  const beforeAt = inputText.value.substring(0, mentionStartIndex.value)

  let displayName: string
  let afterAt: string

  if (memberOrAll === '@all') {
    displayName = '@所有人'

    // 如果 @ 关键词已匹配部分文字，需要计算 @ 后面内容的长度
    // 简化处理：找到下一个空格或文本结束位置
    const remaining = inputText.value.substring(mentionStartIndex.value + 1)
    const spaceIdx = remaining.indexOf(' ')
    afterAt = spaceIdx !== -1 ? remaining.substring(spaceIdx) : ''
  } else {
    displayName = `@${memberOrAll.nickname}`

    // 类似处理
    const remaining = inputText.value.substring(mentionStartIndex.value + 1)
    const spaceIdx = remaining.indexOf(' ')
    afterAt = spaceIdx !== -1 ? remaining.substring(spaceIdx) : ''
  }

  inputText.value = beforeAt + displayName + ' ' + afterAt
  closeMentionSelector()

  // 将光标放在 @昵称 之后
  nextTick(() => {
    const input = document.getElementById('chat-message-input') as HTMLInputElement
    if (input) {
      const newCursor = beforeAt.length + displayName.length + 1
      input.setSelectionRange(newCursor, newCursor)
      input.focus()
    }
  })
}

/**
 * 监听 groupMembers 缓存：切换群聊时清空
 */
watch(() => chatStore.activeGroupId, () => {
  groupMembers.value = []
  closeMentionSelector()
})

/**
 * 键盘事件处理：转发给 MentionSelector
 */
function onKeydown(e: KeyboardEvent) {
  if (mentionActive.value && mentionSelectorRef.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      mentionSelectorRef.value.handleKeydown(e)
      return
    }
  }
  // 如果 Enter 不在 @ 状态，正常发送
  if (e.key === 'Enter' && !mentionActive.value) {
    sendTextMessage()
  }
}

// ========== 文件上传逻辑（保持不变） ==========

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
  if (!chatStore.activeFriendId && !chatStore.activeGroupId) {
    toast.warning('请先选择一个好友或群组再发送文件')
    return
  }

  isUploading.value = true
  try {
    for (const file of files) {
      const type = detectFileType(file)
      await chatStore.sendFile(file, type)
    }
  } catch {
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
    v-if="chatStore.activeFriendId || chatStore.activeGroupId"
    class="col-start-3 px-5 py-3 bg-[var(--color-bg-elevated)] border-t border-[var(--color-border-default)] flex items-center gap-3"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <!-- 文件上传按钮 -->
    <button
      class="w-10 h-10 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-input-bg)] text-[var(--color-text-muted)] cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 hover:border-blue-400 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
      title="发送文件 / 图片"
      :disabled="isUploading"
      @click="onUploadClick"
    >
      <!-- 上传中显示 spinner -->
      <span v-if="isUploading" class="w-4 h-4 border-2 border-[var(--color-text-muted)]/30 border-t-blue-400 rounded-full animate-spin"></span>
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
      id="chat-message-input"
      v-model="inputText"
      type="text"
      :placeholder="isGroupChat ? '输入消息...（输入 @ 可 @ 群成员）' : '输入消息...（可直接拖拽文件到此处）'"
      maxlength="5000"
      class="flex-1 px-4 py-2.5 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[var(--color-text-disabled)]"
      :disabled="isUploading"
      @input="onInput"
      @keydown="onKeydown"
    />

    <!-- 发送按钮 -->
    <button
      class="w-11 h-11 rounded-xl border-none bg-gradient-to-br from-blue-400 to-green-400 text-white cursor-pointer flex items-center justify-center shrink-0 transition-opacity duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="!inputText.trim() || (!chatStore.activeFriendId && !chatStore.activeGroupId) || isUploading || mentionActive"
      @click="sendTextMessage"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>

    <!-- @mention 选择器 -->
    <MentionSelector
      ref="mentionSelectorRef"
      :visible="selectorVisible"
      :keyword="mentionKeyword"
      :members="groupMembers"
      :current-user-id="authStore.currentUser?.id ?? ''"
      @select="onMentionSelect"
      @close="closeMentionSelector"
    />
  </div>
</template>
