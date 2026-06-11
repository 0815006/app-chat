<script setup lang="ts">
import { ref, watch, nextTick, computed, reactive } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import Avatar from '../../components/Avatar.vue'
import ImagePreview from '../../components/ImagePreview.vue'
import type { Message } from '../../types'
import { downloadDir, join } from '@tauri-apps/api/path'
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { toast } from '../../utils/toast'
import { invoke } from '@tauri-apps/api/core'

const authStore = useAuthStore()
const chatStore = useChatStore()
const containerRef = ref<HTMLDivElement>()

/** 图片预览状态 */
const previewVisible = ref(false)
const previewSrc = ref('')

// ==================== 文件下载（文件系统持久化检测） ====================

/**
 * 文件下载状态缓存
 * key: message.id, value: 'undownloaded' | 'downloading' | 'downloaded'
 *
 * 首次渲染时通过文件系统 exists() 填充，重启应用后自动恢复。
 */
const fileDownloadStates = reactive<Record<string, 'undownloaded' | 'downloading' | 'downloaded'>>({})

/** 获取某个消息的文件下载状态（同步，从缓存读取） */
function getFileDownloadState(msgId: string): 'undownloaded' | 'downloading' | 'downloaded' {
  return fileDownloadStates[msgId] ?? 'undownloaded'
}

/** Tauri 本地下载目录缓存 */
let localDownloadDirCache: string | null = null

async function getLocalDownloadDir(): Promise<string> {
  if (localDownloadDirCache) return localDownloadDirCache
  const base = await downloadDir()
  const dir = await join(base, 'ChatDownloads')
  localDownloadDirCache = dir
  return dir
}

/**
 * 根据消息构造唯一本地文件名
 * 格式：原始文件名_消息ID前8位.扩展名
 * 例：报告.pdf (id: a1b2c3d4-...) → 报告_a1b2c3d4.pdf
 */
function buildLocalFileName(msg: Message): string {
  const rawName = msg.file_name ?? 'download'
  const shortId = msg.id.substring(0, 8)
  const dotIdx = rawName.lastIndexOf('.')
  if (dotIdx > 0) {
    return rawName.substring(0, dotIdx) + '_' + shortId + rawName.substring(dotIdx)
  }
  return rawName + '_' + shortId
}

/**
 * 异步查询文件系统，判断某条文件消息是否已下载
 * 将结果写入 fileDownloadStates 缓存，触发响应式更新
 */
async function refreshFileDownloadState(msg: Message) {
  const msgId = msg.id
  // 下载中不允许覆盖
  if (fileDownloadStates[msgId] === 'downloading') return
  
  try {
    const dir = await getLocalDownloadDir()
    const localName = buildLocalFileName(msg)
    const filePath = await join(dir, localName)
    const fileExists = await exists(filePath)
    fileDownloadStates[msgId] = fileExists ? 'downloaded' : 'undownloaded'
  } catch {
    // exists() 抛异常视为未下载
    fileDownloadStates[msgId] = 'undownloaded'
  }
}

/**
 * 监听消息列表变化，自动检测文件类型消息是否已在本地存在
 */
watch(
  () => chatStore.messages,
  (msgs) => {
    for (const m of msgs) {
      if (m.msg_type === 'file' && !(m.id in fileDownloadStates)) {
        refreshFileDownloadState(m as Message)
      }
    }
  },
  { immediate: true, deep: false }
)

function openImagePreview(src: string) {
  previewSrc.value = src
  previewVisible.value = true
}

function closeImagePreview() {
  previewVisible.value = false
}

/** 将字节数格式化为人类可读的文件大小 */
function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * 使用 Tauri 原生文件 API 将远程文件下载到本地 ChatDownloads 目录
 * 文件名 = 原始文件名_消息ID前8位.ext（跨会话唯一可推导）
 */
async function downloadFileToLocal(msg: Message) {
  const msgId = msg.id
  const url = msg.content
  
  if (getFileDownloadState(msgId) !== 'undownloaded') return
  
  fileDownloadStates[msgId] = 'downloading'
  
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`)
    const blob = await res.blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    
    const dir = await getLocalDownloadDir()
    if (!await exists(dir)) {
      await mkdir(dir, { recursive: true })
    }
    
    const localName = buildLocalFileName(msg)
    const filePath = await join(dir, localName)
    await writeFile(filePath, bytes)
    
    fileDownloadStates[msgId] = 'downloaded'
    toast.success(`已下载: ${msg.file_name ?? localName}`)
  } catch (e: any) {
    fileDownloadStates[msgId] = 'undownloaded'
    toast.error(`下载失败: ${e?.message ?? e}`)
  }
}

/**
 * 使用系统默认程序打开本地已下载的文件
 * 打开前校验文件存在性，文件被删则重置为未下载
 */
async function openLocalFile(msg: Message) {
  const msgId = msg.id
  if (getFileDownloadState(msgId) !== 'downloaded') return
  
  try {
    const dir = await getLocalDownloadDir()
    const localName = buildLocalFileName(msg)
    const filePath = await join(dir, localName)
    
    if (!await exists(filePath)) {
      fileDownloadStates[msgId] = 'undownloaded'
      toast.warning('文件已被移动或删除，请重新下载')
      return
    }
    
    await openPath(filePath)
  } catch (e: any) {
    toast.error(`打开文件失败: ${e?.message ?? e}`)
  }
}

// ==================== 右键菜单 ====================

/** 右键菜单是否可见 */
const contextMenuVisible = ref(false)
/** 菜单左上角 X 坐标（px） */
const contextMenuX = ref(0)
/** 菜单左上角 Y 坐标（px） */
const contextMenuY = ref(0)
/** 当前右键点击的消息 */
const contextMenuMessage = ref<Message | null>(null)

interface ContextMenuItem {
  label: string
  action: string
  /** 是否为危险操作（红色文字） */
  danger?: boolean
  /** 分割线，显示在该项上方 */
  divider?: boolean
}

/** 根据消息类型和下载状态计算右键菜单项 */
const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const msg = contextMenuMessage.value
  if (!msg) return []

  const isSelf = msg.sender_id === authStore.currentUser?.id
  const isMedia = msg.msg_type === 'image' || msg.msg_type === 'file'
  const isDownloaded = isMedia && getFileDownloadState(msg.id) === 'downloaded'

  const items: ContextMenuItem[] = []

  if (!isSelf) {
    // 接收的消息
    if (isDownloaded) {
      items.push({ label: '打开文件', action: 'open_file' })
      items.push({ label: '在文件夹中显示', action: 'show_in_folder' })
      items.push({ divider: true, label: '', action: '' })
    }
    items.push({ label: '删除', action: 'delete', danger: true })
  } else {
    // 自己发送的消息
    if (!msg.is_revoked) {
      items.push({ label: '撤回', action: 'revoke' })
      items.push({ divider: true, label: '', action: '' })
    }
    items.push({ label: '删除', action: 'delete', danger: true })
  }

  return items
})

/** 右键菜单定位样式（预计算，避免模板中直接引用 window 导致 ts-plugin 报错） */
const contextMenuStyle = computed(() => {
  if (!contextMenuVisible.value) return {}
  return {
    left: Math.min(contextMenuX.value, window.innerWidth - 172) + 'px',
    top: Math.min(contextMenuY.value, window.innerHeight - 40 - contextMenuItems.value.length * 36) + 'px',
  }
})

/** 右键消息气泡时触发 */
function onContextMenu(event: MouseEvent, msg: Message) {
  event.preventDefault()
  // 先关闭已有菜单
  contextMenuVisible.value = false

  // 使用 requestAnimationFrame 确保 DOM 更新后再设置新位置
  requestAnimationFrame(() => {
    contextMenuMessage.value = msg as Message
    contextMenuX.value = event.clientX
    contextMenuY.value = event.clientY
    contextMenuVisible.value = true
  })
}

/** 关闭右键菜单 */
function closeContextMenu() {
  contextMenuVisible.value = false
  contextMenuMessage.value = null
}

/** 获取某条媒体消息的本地文件绝对路径 */
async function getLocalFilePath(msg: Message): Promise<string> {
  const dir = await getLocalDownloadDir()
  const localName = buildLocalFileName(msg)
  return await join(dir, localName)
}

/** 处理右键菜单操作 */
async function handleContextMenuAction(action: string) {
  const msg = contextMenuMessage.value
  if (!msg) return

  closeContextMenu()

  switch (action) {
    case 'open_file':
      await openLocalFile(msg)
      break
    case 'show_in_folder': {
      try {
        const filePath = await getLocalFilePath(msg)
        await invoke('show_in_folder', { path: filePath })
      } catch (e: any) {
        toast.error(`无法打开文件所在位置: ${e?.message ?? e}`)
      }
      break
    }
    case 'delete':
      chatStore.deleteMessageLocally(msg.id)
      break
    case 'revoke':
      await chatStore.revokeMessage(msg.id)
      break
  }
}

/** 监听 Escape 键关闭菜单 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && contextMenuVisible.value) {
    closeContextMenu()
  }
}

// 注册/注销键盘监听
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeyDown)
}

/** 时间分隔线阈值：5 分钟 */
const TIME_GAP_MS = 5 * 60 * 1000

/** 正在加载更多消息（滚动到顶部时） */
const isPullingMore = ref(false)

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

// 切换好友 / 新消息时自动滚底（但不包括加载更多触发的消息变化）
watch(
  () => [chatStore.activeFriendId, chatStore.messages.length] as const,
  async (_new, _old) => {
    // 如果是加载更多触发的（hasMore 从 true 变成了变化），不自动滚底
    if (isPullingMore.value) return

    await nextTick()
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight
    }
  }
)

// 切换好友时自动关闭右键菜单
watch(
  () => chatStore.activeFriendId,
  () => {
    closeContextMenu()
  }
)

/** 监听滚动到顶部，触发加载更多 */
function onScroll() {
  if (!containerRef.value) return
  const el = containerRef.value

  // 滚动到顶部（< 60px 阈值）时触发加载更多
  if (el.scrollTop <= 60 && !isPullingMore.value && chatStore.hasMore && !chatStore.isLoadingMore) {
    pullMoreHistory()
  }
}

/** 加载更早的历史消息，并保持滚动位置不弹跳 */
async function pullMoreHistory() {
  if (!containerRef.value || isPullingMore.value || !chatStore.hasMore) return

  isPullingMore.value = true
  const el = containerRef.value
  // 记录加载前的内容高度
  const prevScrollHeight = el.scrollHeight

  const count = await chatStore.loadMoreHistory()

  if (count > 0) {
    await nextTick()
    // 加载后 scrollHeight 变大，差值即为新增内容的高度
    // 把 scrollTop 设置为这个差值，使视口内容保持不变
    const newScrollHeight = el.scrollHeight
    el.scrollTop = newScrollHeight - prevScrollHeight
  }

  isPullingMore.value = false
}

function isSeparator(item: Message | { _sep: boolean; time: Date }): item is { _sep: true; time: Date } {
  return '_sep' in item
}

function formatSeparatorTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
<div class="contents">
  <!-- 有好友时 -->
  <main v-if="chatStore.activeFriendId" class="flex flex-col overflow-hidden bg-[#1a1a2e]">
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
    <div
      ref="containerRef"
      class="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar flex flex-col gap-0.5"
      @scroll="onScroll"
    >
      <!-- 顶部加载更多指示器 -->
      <div
        v-if="chatStore.isLoadingMore"
        class="flex items-center justify-center py-3 text-[#718096] text-xs"
      >
        <span class="w-3.5 h-3.5 border-2 border-[#718096]/30 border-t-[#718096] rounded-full animate-spin mr-2"></span>
        加载历史消息...
      </div>
      <div
        v-else-if="!chatStore.hasMore && chatStore.messages.length >= 20"
        class="flex items-center justify-center py-3"
      >
        <span class="text-[11px] text-[#4a5568]">没有更多消息了</span>
      </div>

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
          @contextmenu.prevent="onContextMenu($event, item)"
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
              :class="item.is_revoked
                ? 'bg-[#ffffff08] border border-[#ffffff0d] text-[#56657a] italic rounded-br-md'
                : item.sender_id === authStore.currentUser?.id
                  ? 'bg-gradient-to-br from-blue-400 to-green-400 text-white rounded-br-md'
                  : 'bg-[#1e293b] text-[#e2e8f0] rounded-bl-md'"
            >
              <!-- 已撤回（仅发送者可见） -->
              <p v-if="item.is_revoked" class="px-4 py-2.5 text-[13px] flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 shrink-0 opacity-50">
                  <polyline points="1 4 1 10 7 10" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>你撤回了一条消息</span>
              </p>
              <!-- 文本 -->
              <p v-else-if="item.msg_type === 'text'" class="px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap">{{ item.content }}</p>

              <!-- 图片 -->
              <div v-else-if="item.msg_type === 'image'" class="p-1">
                <img
                  :src="item.content"
                  :alt="item.file_name ?? '图片消息'"
                  class="max-w-[360px] max-h-[360px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  @click.stop="openImagePreview(item.content)"
                />
              </div>

              <!-- 文件 -->
              <div
                v-else-if="item.msg_type === 'file'"
                class="flex items-center gap-3 px-4 py-3 text-[14px] min-w-[200px]"
                :class="getFileDownloadState(item.id) === 'downloaded' ? 'cursor-pointer hover:opacity-80' : ''"
                role="button"
                tabindex="0"
                @click.stop="getFileDownloadState(item.id) === 'undownloaded' ? downloadFileToLocal(item) : null"
                @dblclick.stop="getFileDownloadState(item.id) === 'downloaded' ? openLocalFile(item) : null"
              >
                <!-- 图标区域 -->
                <span class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  :class="getFileDownloadState(item.id) === 'downloading'
                    ? 'bg-white/10'
                    : getFileDownloadState(item.id) === 'downloaded'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-white/15'"
                >
                  <!-- 下载中：spinner -->
                  <svg v-if="getFileDownloadState(item.id) === 'downloading'" class="w-5 h-5 animate-spin text-white/70" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round" opacity="0.25"/>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round" stroke-dashoffset="15.7"/>
                  </svg>
                  <!-- 已下载：对勾 -->
                  <svg v-else-if="getFileDownloadState(item.id) === 'downloaded'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
                    <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <!-- 未下载：下载箭头 -->
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
                <!-- 文件名 + 大小 -->
                <div class="flex flex-col min-w-0">
                  <span class="truncate text-[14px]">{{ item.file_name ?? item.content.split('/').pop() ?? '未知文件' }}</span>
                  <span v-if="item.file_size" class="text-[11px] opacity-60">
                    <template v-if="getFileDownloadState(item.id) === 'downloading'">下载中...</template>
                    <template v-else-if="getFileDownloadState(item.id) === 'downloaded'">已下载 · 双击打开</template>
                    <template v-else>点击下载 · {{ formatFileSize(item.file_size) }}</template>
                  </span>
                </div>
              </div>

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
  <main v-else class="flex items-center justify-center overflow-hidden bg-[#1a1a2e]">
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

  <!-- 右键菜单遮罩层 -->
  <Teleport to="body">
    <div
      v-if="contextMenuVisible"
      class="fixed inset-0 z-[9999]"
      @click="closeContextMenu"
      @scroll.prevent="closeContextMenu"
    >
      <!-- 菜单面板 -->
      <div
        class="absolute min-w-[160px] bg-[#1e1e2e] border border-[#2d3748] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.45)] py-1.5 backdrop-blur-sm"
        :style="contextMenuStyle"
        @click.stop
      >
        <template v-for="(menuItem, idx) in contextMenuItems">
          <!-- 分割线 -->
          <div v-if="menuItem.divider" :key="'div-' + idx" class="my-1 border-t border-[#ffffff0d]"></div>
          <!-- 菜单项 -->
          <button
            v-else
            :key="'btn-' + idx"
            class="w-full text-left px-3.5 py-2 text-[13px] transition-colors duration-100 flex items-center gap-2.5"
            :class="menuItem.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-[#cbd5e0] hover:bg-[#ffffff0a]'"
            @click="handleContextMenuAction(menuItem.action)"
          >
            <!-- 图标 -->
            <svg v-if="menuItem.action === 'open_file'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 shrink-0">
              <path d="M15 3h6v6M21 3l-9 9M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else-if="menuItem.action === 'show_in_folder'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 shrink-0">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"/>
            </svg>
            <svg v-else-if="menuItem.action === 'revoke'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 shrink-0">
              <polyline points="1 4 1 10 7 10" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else-if="menuItem.action === 'delete'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 shrink-0">
              <polyline points="3 6 5 6 21 6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>{{ menuItem.label }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>

  <!-- 图片预览 -->
  <ImagePreview
    :src="previewSrc"
    :visible="previewVisible"
    @close="closeImagePreview"
  />
</div>
</template>
