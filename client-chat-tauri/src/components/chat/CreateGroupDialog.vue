<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../utils/toast'
import type { Friend } from '../../types'
import Avatar from '../Avatar.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const chatStore = useChatStore()
const authStore = useAuthStore()

const groupName = ref('')
const selectedIds = ref<Set<string>>(new Set())
const isCreating = ref(false)
const step = ref<'select' | 'name'>('select')

/** 可选的成员列表（排除自己） */
const availableFriends = computed(() =>
  chatStore.friends.filter(f => f.friend_id !== authStore.currentUser?.id)
)

/** 已选中的好友详情列表 */
const selectedFriends = computed(() =>
  chatStore.friends.filter(f => selectedIds.value.has(f.friend_id))
)

/** 已选数量 */
const selectedCount = computed(() => selectedIds.value.size)

/** 切换选中 */
function toggleSelect(friendId: string) {
  const next = new Set(selectedIds.value)
  if (next.has(friendId)) {
    next.delete(friendId)
  } else {
    next.add(friendId)
  }
  selectedIds.value = next
}

/** 下一步：输入群名称 */
function goToName() {
  if (selectedIds.value.size === 0) {
    toast.warning('请至少选择一位好友')
    return
  }
  // 默认群名：前3位好友昵称 + "..."
  const names = Array.from(selectedIds.value)
    .map(id => chatStore.friends.find(f => f.friend_id === id)?.name ?? '')
    .filter(Boolean)
    .slice(0, 3)
  const defaultName = names.join('、') + (selectedIds.value.size > 3 ? '等' : '') + '的群聊'
  if (!groupName.value) {
    groupName.value = defaultName
  }
  step.value = 'name'
}

/** 上一步 */
function goBack() {
  step.value = 'select'
}

/** 确认创建 */
async function handleCreate() {
  const name = groupName.value.trim()
  if (!name) {
    toast.warning('请输入群聊名称')
    return
  }
  if (name.length > 20) {
    toast.warning('群聊名称最长 20 个字符')
    return
  }
  isCreating.value = true
  try {
    const memberIds = Array.from(selectedIds.value)
    await chatStore.createGroup(name, memberIds)
    close()
  } catch {
    // toast already shown in store
  } finally {
    isCreating.value = false
  }
}

/** 关闭弹窗 */
function close() {
  groupName.value = ''
  selectedIds.value = new Set()
  step.value = 'select'
  isCreating.value = false
  emit('close')
}

/** 按 Esc 关闭 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (step.value === 'name') {
      goBack()
    } else {
      close()
    }
  }
}

// 弹窗打开时重置
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      groupName.value = ''
      selectedIds.value = new Set()
      step.value = 'select'
      isCreating.value = false
      await nextTick()
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @keydown="onKeydown"
      >
        <!-- 遮罩层 -->
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          @click="close"
        ></div>

        <!-- 弹窗本体 -->
        <div
          class="relative w-full max-w-[520px] rounded-2xl bg-[#141028] border border-white/[0.06] shadow-[0_25px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)] flex flex-col overflow-hidden"
          :class="step === 'select' ? 'min-h-[480px] max-h-[620px]' : 'min-h-[380px]'"
        >
          <!-- ========== 标题栏 ========== -->
          <div class="relative shrink-0 px-6 pt-6 pb-0">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shadow-[0_4px_12px_rgba(168,85,247,0.2)]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" class="w-5 h-5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <div>
                  <h2 class="text-[16px] font-semibold text-white">
                    {{ step === 'select' ? '创建群聊' : '设置群名称' }}
                  </h2>
                  <p class="text-[12px] text-[#64748b] mt-0.5">
                    <template v-if="step === 'select'">选择至少 2 位好友发起群聊</template>
                    <template v-else>为你的群聊取一个名字</template>
                  </p>
                </div>
              </div>
              <button
                class="w-8 h-8 rounded-lg flex items-center justify-center text-[#475569] hover:text-white hover:bg-white/[0.06] transition-all duration-200 cursor-pointer"
                @click="close"
                aria-label="关闭"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
                  <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <div class="mt-4 h-px bg-gradient-to-r from-purple-400/40 via-transparent to-transparent"></div>
          </div>

          <!-- ========== Step 1: 选择成员 ========== -->
          <template v-if="step === 'select'">
            <!-- 已选标签 -->
            <div v-if="selectedCount > 0" class="shrink-0 px-6 pt-3 pb-1 flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] text-[#64748b] mr-1">已选 {{ selectedCount }} 人：</span>
              <span
                v-for="friend in selectedFriends.slice(0, 8)"
                :key="friend.friend_id"
                class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-400/10 border border-purple-400/20 text-[12px] text-purple-300"
              >
                {{ friend.name }}
                <button
                  class="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-purple-400/30 transition-colors cursor-pointer"
                  @click="toggleSelect(friend.friend_id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-2.5 h-2.5">
                    <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/>
                  </svg>
                </button>
              </span>
              <span v-if="selectedCount > 8" class="text-[11px] text-[#475569]">+{{ selectedCount - 8 }}</span>
            </div>

            <!-- 好友列表 -->
            <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-3">
              <!-- 加载中 -->
              <div v-if="chatStore.isLoadingFriends" class="flex flex-col items-center justify-center py-16">
                <span class="w-5 h-5 border-2 border-[#718096]/30 border-t-purple-400 rounded-full animate-spin mb-3"></span>
                <span class="text-[13px] text-[#64748b]">加载好友列表...</span>
              </div>

              <!-- 空态 -->
              <div v-else-if="availableFriends.length === 0" class="flex flex-col items-center justify-center py-16">
                <div class="w-14 h-14 rounded-2xl bg-white/[0.02] flex items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-7 h-7 text-[#334155]">
                    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <p class="text-[14px] text-[#64748b]">暂无好友</p>
                <p class="text-[12px] text-[#475569] mt-1">请先添加好友后再创建群聊</p>
              </div>

              <!-- 好友列表 -->
              <div v-else class="space-y-1">
                <button
                  v-for="friend in availableFriends"
                  :key="friend.friend_id"
                  class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer group"
                  :class="selectedIds.has(friend.friend_id)
                    ? 'bg-purple-400/10 border border-purple-400/25'
                    : 'border border-transparent hover:bg-white/[0.04]'"
                  @click="toggleSelect(friend.friend_id)"
                >
                  <!-- 复选框 -->
                  <div
                    class="w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200"
                    :class="selectedIds.has(friend.friend_id)
                      ? 'bg-purple-400 border-purple-400'
                      : 'border-2 border-[#334155] group-hover:border-[#475569]'"
                  >
                    <svg v-if="selectedIds.has(friend.friend_id)" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3 h-3">
                      <path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>

                  <Avatar
                    :name="friend.name"
                    :avatar-url="friend.avatar_url"
                    :online="friend.online"
                    size="sm"
                  />
                  <div class="flex-1 text-left min-w-0">
                    <div class="text-[14px] text-[#e2e8f0] truncate">{{ friend.name }}</div>
                    <div class="text-[11px] text-[#475569] truncate">{{ friend.employee_id || '' }}</div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span
                      class="w-2 h-2 rounded-full"
                      :class="friend.online ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]' : 'bg-[#334155]'"
                    ></span>
                  </div>
                </button>
              </div>
            </div>

            <!-- 底部操作栏 -->
            <div class="shrink-0 px-6 py-4 border-t border-white/[0.04] flex items-center justify-between">
              <span class="text-[12px] text-[#475569]">已选择 {{ selectedCount }} 位好友</span>
              <button
                class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-400 to-pink-400 text-white text-[14px] font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-[0_4px_16px_rgba(168,85,247,0.25)] transition-all duration-200 cursor-pointer"
                :disabled="selectedCount === 0"
                @click="goToName"
              >
                下一步
              </button>
            </div>
          </template>

          <!-- ========== Step 2: 设置群名 ========== -->
          <template v-if="step === 'name'">
            <div class="flex-1 px-6 py-5 space-y-4">
              <!-- 已选成员预览 -->
              <div>
                <label class="text-[12px] text-[#64748b] mb-2 block">群成员 ({{ selectedCount }} 人)</label>
                <div class="flex flex-wrap gap-1.5">
                  <div
                    v-for="friend in selectedFriends"
                    :key="friend.friend_id"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05]"
                  >
                    <Avatar :name="friend.name" :avatar-url="friend.avatar_url" size="sm" />
                    <span class="text-[13px] text-[#e2e8f0]">{{ friend.name }}</span>
                  </div>
                </div>
              </div>

              <!-- 群名称输入 -->
              <div>
                <label class="text-[12px] text-[#64748b] mb-2 block">群聊名称</label>
                <div class="relative group">
                  <div class="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-400/20 to-pink-400/20 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 -m-[1px]"></div>
                  <div class="relative bg-[#0f0b24] rounded-xl border border-white/[0.06] group-focus-within:border-purple-400/30 transition-colors duration-300">
                    <input
                      v-model="groupName"
                      type="text"
                      placeholder="输入群聊名称..."
                      maxlength="20"
                      class="w-full px-4 py-3 bg-transparent text-white text-[14px] outline-none placeholder:text-[#475569]"
                      @keyup.enter="handleCreate"
                    />
                  </div>
                </div>
                <p class="text-[11px] text-[#475569] mt-1.5">{{ groupName.length }}/20 个字符</p>
              </div>
            </div>

            <!-- 底部操作栏 -->
            <div class="shrink-0 px-6 py-4 border-t border-white/[0.04] flex items-center justify-between">
              <button
                class="px-4 py-2.5 rounded-xl bg-white/[0.04] text-[#64748b] text-[14px] hover:text-white hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
                @click="goBack"
              >
                返回选择
              </button>
              <button
                class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-400 to-pink-400 text-white text-[14px] font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-[0_4px_16px_rgba(168,85,247,0.25)] transition-all duration-200 flex items-center gap-2 cursor-pointer"
                :disabled="!groupName.trim() || isCreating"
                @click="handleCreate"
              >
                <span v-if="isCreating" class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span v-else>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
                    <path d="M12 5v14M5 12h14" stroke-linecap="round"/>
                  </svg>
                </span>
                {{ isCreating ? '创建中...' : '创建群聊' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ========== 模态框过渡动画 ========== */
.modal-enter-active {
  transition: opacity 0.2s ease-out;
}
.modal-leave-active {
  transition: opacity 0.15s ease-in;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active > div:last-child {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out;
}
.modal-leave-active > div:last-child {
  transition: transform 0.15s ease-in, opacity 0.1s ease-in;
}
.modal-enter-from > div:last-child {
  transform: scale(0.95) translateY(8px);
  opacity: 0;
}
.modal-leave-to > div:last-child {
  transform: scale(0.97);
  opacity: 0;
}

/* ========== 自定义滚动条 ========== */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 0.04);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgb(255 255 255 / 0.08);
}
</style>
