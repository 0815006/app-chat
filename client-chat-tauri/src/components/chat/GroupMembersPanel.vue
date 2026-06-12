<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import type { GroupMember } from '../../types'
import Avatar from '../Avatar.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const chatStore = useChatStore()
const authStore = useAuthStore()

const members = ref<GroupMember[]>([])
const isLoading = ref(false)
const isRemoving = ref<Set<string>>(new Set())

/** 当前用户是否是群主 */
const isOwner = () => {
  if (!chatStore.activeGroup) return false
  return chatStore.activeGroup.owner_id === authStore.currentUser?.id
}

/** 加载成员 */
async function loadMembers() {
  if (!chatStore.activeGroup) return
  isLoading.value = true
  try {
    members.value = await chatStore.fetchGroupMembers(chatStore.activeGroup.id)
  } finally {
    isLoading.value = false
  }
}

/** 踢出成员 */
async function kickMember(member: GroupMember) {
  if (!chatStore.activeGroup || isRemoving.value.has(member.user_id)) return
  isRemoving.value.add(member.user_id)
  try {
    await chatStore.removeGroupMember(chatStore.activeGroup.id, member.user_id)
    // 从本地列表移除
    members.value = members.value.filter(m => m.user_id !== member.user_id)
  } finally {
    isRemoving.value.delete(member.user_id)
  }
}

/** 退出群聊 */
async function leaveGroup() {
  if (!chatStore.activeGroup || !authStore.currentUser) return
  try {
    await chatStore.removeGroupMember(chatStore.activeGroup.id, authStore.currentUser.id)
    close()
  } catch {
    // toast already shown in store
  }
}

/** 解散群聊 */
async function dissolveGroup() {
  if (!chatStore.activeGroup) return
  try {
    await chatStore.dissolveGroup(chatStore.activeGroup.id)
    close()
  } catch {
    // toast already shown in store
  }
}

/** 关闭面板 */
function close() {
  members.value = []
  emit('close')
}

/** 按 Esc 关闭 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// 可见性变化时加载数据
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await loadMembers()
    }
  }
)

onUnmounted(() => {
  members.value = []
})
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩层 -->
    <Transition name="mask">
      <div
        v-if="visible"
        class="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        @click="close"
      ></div>
    </Transition>

    <!-- 侧面板 -->
    <Transition name="panel">
      <div
        v-if="visible"
        class="fixed right-0 top-0 bottom-0 z-50 w-[340px] bg-[#141028] border-l border-white/[0.06] shadow-[-8px_0_30px_rgba(0,0,0,0.4)] flex flex-col"
        @keydown="onKeydown"
      >
        <!-- 标题栏 -->
        <div class="shrink-0 px-5 pt-5 pb-3">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-[15px] font-semibold text-white">群成员</h3>
              <p v-if="chatStore.activeGroup" class="text-[12px] text-[#64748b] mt-0.5">
                {{ chatStore.activeGroup.name }}
                <span v-if="chatStore.activeGroup.member_count">· {{ chatStore.activeGroup.member_count }} 人</span>
              </p>
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
          <div class="mt-3 h-px bg-gradient-to-r from-purple-400/30 via-transparent to-transparent"></div>
        </div>

        <!-- 成员列表 -->
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-2">
          <!-- 加载中 -->
          <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
            <span class="w-4 h-4 border-2 border-[#718096]/30 border-t-purple-400 rounded-full animate-spin mb-2.5"></span>
            <span class="text-[12px] text-[#64748b]">加载成员列表...</span>
          </div>

          <!-- 成员列表 -->
          <div v-else class="space-y-0.5">
            <div
              v-for="member in members"
              :key="member.user_id"
              class="flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/[0.04] transition-colors duration-150 group"
            >
              <Avatar
                :name="member.nickname ?? '?'"
                :avatar-url="member.avatar_url"
                :online="member.is_online"
                size="sm"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-[14px] text-[#e2e8f0] truncate">{{ member.nickname ?? '未知用户' }}</span>
                  <!-- 群主标记 -->
                  <span
                    v-if="member.role === 'owner'"
                    class="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-400/10 border border-amber-400/20 text-amber-400 shrink-0"
                  >
                    群主
                  </span>
                  <!-- 自己标记 -->
                  <span
                    v-else-if="member.user_id === authStore.currentUser?.id"
                    class="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05] text-[#64748b] shrink-0"
                  >
                    我
                  </span>
                </div>
                <div class="text-[11px] text-[#475569] truncate">
                  {{ member.employee_id || '' }}
                  <template v-if="!member.employee_id">&nbsp;</template>
                </div>
              </div>

              <!-- 在线状态 -->
              <div class="flex items-center gap-2 shrink-0">
                <span
                  class="w-2 h-2 rounded-full"
                  :class="member.is_online ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]' : 'bg-[#334155]'"
                ></span>

                <!-- 群主可踢人（自己不能踢自己） -->
                <button
                  v-if="isOwner() && member.user_id !== authStore.currentUser?.id"
                  class="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] hover:text-red-400 hover:bg-red-400/10 transition-all duration-200 opacity-0 group-hover:opacity-100 cursor-pointer"
                  :disabled="isRemoving.has(member.user_id)"
                  @click.stop="kickMember(member)"
                  :title="'移出群聊'"
                >
                  <span v-if="isRemoving.has(member.user_id)" class="w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin"></span>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
                    <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="shrink-0 px-5 py-4 border-t border-white/[0.04] space-y-2">
          <!-- 群主：解散群 -->
          <button
            v-if="isOwner()"
            class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-400/8 border border-red-400/15 text-red-400 text-[13px] font-medium hover:bg-red-400/15 hover:border-red-400/25 transition-all duration-200 cursor-pointer"
            @click="dissolveGroup"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            解散群聊
          </button>

          <!-- 非群主：退出群 -->
          <button
            v-else
            class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-400/8 border border-red-400/15 text-red-400 text-[13px] font-medium hover:bg-red-400/15 hover:border-red-400/25 transition-all duration-200 cursor-pointer"
            @click="leaveGroup"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            退出群聊
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ========== 遮罩过渡 ========== */
.mask-enter-active {
  transition: opacity 0.2s ease-out;
}
.mask-leave-active {
  transition: opacity 0.2s ease-in;
}
.mask-enter-from,
.mask-leave-to {
  opacity: 0;
}

/* ========== 面板滑动过渡 ========== */
.panel-enter-active {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.panel-leave-active {
  transition: transform 0.2s ease-in;
}
.panel-enter-from {
  transform: translateX(100%);
}
.panel-leave-to {
  transform: translateX(100%);
}

/* ========== 自定义滚动条 ========== */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 0.04);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgb(255 255 255 / 0.08);
}
</style>
