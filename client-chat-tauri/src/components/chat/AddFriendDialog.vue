<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../utils/toast'
import { resolveFileUrl } from '../../utils/fileUrl'
import type { User, UserSortField } from '../../types'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const chatStore = useChatStore()
const authStore = useAuthStore()

const keyword = ref('')
const results = ref<User[]>([])
const isSearching = ref(false)
const searched = ref(false)
const addingIds = ref<Set<string>>(new Set())

/** 是否为浏览全部用户模式 */
const isBrowsingAll = ref(false)

/** 排序字段 */
const sortField = ref<UserSortField>('created_at')

/** 排序选项 — 以 pill 形式展示 */
const sortOptions: { label: string; value: UserSortField }[] = [
  { label: '注册时间', value: 'created_at' },
  { label: '名称', value: 'nickname' },
  { label: '工号', value: 'employee_id' },
]

/** 好友 ID 集合（快速查找是否已为好友） */
const friendIds = computed<Set<string>>(() => {
  return new Set(chatStore.friends.map((f) => f.friend_id))
})

/** 从当前 result 中已排除自己 */
function excludeSelf(users: User[]): User[] {
  return users.filter((u) => u.id !== authStore.currentUser?.id)
}

/** 获取头像首字母 */
function avatarInitial(user: User): string {
  return (user.nickname || '?').charAt(0)
}

/** 执行搜索 */
async function doSearch() {
  const q = keyword.value.trim()
  if (q.length < 2) {
    results.value = []
    searched.value = false
    return
  }

  isSearching.value = true
  searched.value = true
  isBrowsingAll.value = false
  try {
    const users = await chatStore.searchUsers(q)
    results.value = excludeSelf(users)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '搜索失败')
  } finally {
    isSearching.value = false
  }
}

/** 浏览所有注册用户 */
async function browseAllUsers() {
  isSearching.value = true
  isBrowsingAll.value = true
  searched.value = true
  keyword.value = ''
  try {
    const users = await chatStore.fetchAllUsers(sortField.value)
    results.value = excludeSelf(users)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '获取用户列表失败')
  } finally {
    isSearching.value = false
  }
}

/** 切换排序并重新加载 */
async function onChangeSort(newSort: UserSortField) {
  sortField.value = newSort
  if (isBrowsingAll.value) {
    await browseAllUsers()
  }
}

/** 添加好友 */
async function handleAdd(user: User) {
  if (addingIds.value.has(user.id)) return
  addingIds.value.add(user.id)
  try {
    await chatStore.addFriend(user.id)
    toast.success(`已添加 ${user.nickname} 为好友`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '添加好友失败')
  } finally {
    addingIds.value.delete(user.id)
  }
}

/** 关闭弹窗，清空所有状态 */
function close() {
  keyword.value = ''
  results.value = []
  searched.value = false
  isBrowsingAll.value = false
  sortField.value = 'created_at'
  emit('close')
}

/** 按 Esc 关闭 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// 弹窗打开时自动聚焦搜索框
const inputRef = ref<HTMLInputElement | null>(null)
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await nextTick()
      setTimeout(() => inputRef.value?.focus(), 150)
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

        <!-- 弹窗本体 — 加宽以容纳卡片网格 -->
        <div
          class="relative w-full max-w-[720px] min-h-[540px] max-h-[680px] rounded-2xl bg-[var(--color-bg-dialog)] border border-[var(--color-border-subtle)] shadow-[0_25px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)] flex flex-col overflow-hidden"
        >
          <!-- ========== 标题栏 ========== -->
          <div class="relative shrink-0 px-6 pt-6 pb-0">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center shadow-[0_4px_12px_rgba(66,153,225,0.2)]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" class="w-5 h-5">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke-linecap="round" stroke-linejoin="round"/>
                    <line x1="19" y1="8" x2="19" y2="14" stroke-linecap="round"/>
                    <line x1="22" y1="11" x2="16" y2="11" stroke-linecap="round"/>
                  </svg>
                </div>
                <div>
                  <h2 class="text-[16px] font-semibold text-[var(--color-text-heading)]">添加好友</h2>
                  <p class="text-[12px] text-[var(--color-text-dim)] mt-0.5">通过昵称或工号搜索用户</p>
                </div>
              </div>
              <button
                class="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-dim)] hover:text-white hover:bg-[var(--color-hover-strong)] transition-all duration-200 cursor-pointer"
                @click="close"
                aria-label="关闭"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
                  <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <!-- 渐变色底部装饰线 -->
            <div class="mt-4 h-px bg-gradient-to-r from-blue-400/40 via-transparent to-transparent"></div>
          </div>

          <!-- ========== 搜索栏 + 操作区 ========== -->
          <div class="shrink-0 px-6 pt-4 pb-3 space-y-3">
            <!-- 搜索框 -->
            <div class="relative group">
              <div class="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-400/20 to-green-400/20 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 -m-[1px]"></div>
              <div class="relative flex items-center bg-[var(--color-bg-dialog-input)] rounded-xl border border-[var(--color-border-subtle)] group-focus-within:border-blue-400/30 transition-colors duration-300">
                <!-- 搜索图标 -->
                <svg
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  class="absolute left-3.5 w-4 h-4 text-[var(--color-text-dim)] group-focus-within:text-blue-400 transition-colors duration-300 pointer-events-none"
                >
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  ref="inputRef"
                  v-model="keyword"
                  type="text"
                  placeholder="搜索昵称或工号..."
                  class="w-full pl-10 pr-20 py-3 bg-transparent text-[var(--color-text-heading)] text-[14px] outline-none placeholder:text-[var(--color-text-dim)]"
                  @keyup.enter="doSearch"
                  @input="searched = false; isBrowsingAll = false"
                />
                <!-- 搜索按钮 / 清除按钮 -->
                <div class="absolute right-2 flex items-center gap-1">
                  <button
                    v-if="keyword"
                    class="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-dim)] hover:text-white hover:bg-[var(--color-hover-strong)] transition-colors cursor-pointer"
                    @click="keyword = ''; searched = false; inputRef?.focus()"
                    aria-label="清除"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
                      <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <button
                    class="h-9 px-4 rounded-lg bg-blue-500 text-white text-[13px] font-medium hover:bg-blue-600 active:scale-[0.97] transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
                    :disabled="keyword.trim().length < 2 || isSearching"
                    @click="doSearch"
                  >
                    搜索
                  </button>
                </div>
              </div>
            </div>

            <!-- 排序 + 浏览全部 -->
            <div class="flex items-center justify-between gap-3">
              <!-- 排序标签 -->
              <div class="flex items-center gap-1.5 p-0.5 rounded-lg bg-[var(--color-hover-weak)]">
                <button
                  v-for="opt in sortOptions"
                  :key="opt.value"
                  class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200 cursor-pointer"
                  :class="sortField === opt.value
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]'"
                  @click="onChangeSort(opt.value)"
                >
                  按{{ opt.label }}
                </button>
              </div>

              <!-- 查看全部按钮 -->
              <button
                class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-hover-bg)] transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="isSearching"
                @click="browseAllUsers"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="9" cy="7" r="4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                查看全部用户
              </button>
            </div>
          </div>

          <!-- ========== 内容区 ========== -->
          <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-6">
            <!-- 加载骨架 — 卡片骨架网格 -->
            <div v-if="isSearching" class="py-2 card-grid">
              <div
                v-for="i in 10" :key="i"
                class="skeleton-card animate-pulse"
              >
                <div class="w-10 h-10 rounded-full bg-[var(--color-hover-bg)] shrink-0"></div>
                <div class="flex-1 ml-2 space-y-1.5">
                  <div class="h-2.5 w-16 rounded-full bg-[var(--color-hover-bg)]"></div>
                  <div class="h-2 w-12 rounded-full bg-[var(--color-hover-weak)]"></div>
                </div>
              </div>
            </div>

            <!-- 结果网格 -->
            <template v-else-if="results.length > 0">
              <!-- 结果计数 -->
              <div class="sticky top-0 z-10 -mx-5 px-5 py-2.5 bg-[var(--color-bg-dialog)]/95 backdrop-blur-sm">
                <div class="flex items-center gap-2 text-[12px]">
                  <span class="font-medium text-[var(--color-text-secondary)]">
                    {{ isBrowsingAll ? '全部用户' : '搜索结果' }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded-md bg-[var(--color-hover-bg)] text-[var(--color-text-dim)] font-medium tabular-nums">
                    {{ results.length }}
                  </span>
                </div>
              </div>

              <!-- 用户卡片网格 -->
              <TransitionGroup name="card" tag="div" class="card-grid pb-2">
                <!-- ===== 单个用户卡片 ===== -->
                <div
                  v-for="user in results"
                  :key="user.id"
                  class="user-card group"
                  :class="{ 'is-friend': friendIds.has(user.id) }"
                >
                  <!-- 头像区 -->
                  <div class="relative shrink-0">
                    <div
                      v-if="user.avatar_url"
                      class="w-10 h-10 rounded-full overflow-hidden"
                    >
                      <img :src="resolveFileUrl(user.avatar_url)" class="w-full h-full object-cover" alt="" />
                    </div>
                    <div
                      v-else
                      class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400/80 to-green-400/80 flex items-center justify-center text-white text-base font-semibold"
                    >
                      {{ avatarInitial(user) }}
                    </div>
                    <!-- 在线状态点 -->
                    <span
                      class="absolute bottom-px right-px w-2.5 h-2.5 rounded-full ring-2 ring-[var(--color-bg-dialog)]"
                      :class="user.status === 'online' ? 'bg-green-400' : 'bg-[var(--color-text-dim)]'"
                    ></span>
                  </div>

                  <!-- 用户信息 -->
                  <div class="flex-1 min-w-0 ml-2">
                    <div class="text-[11px] font-medium text-[var(--color-text-heading)] truncate">{{ user.nickname }}</div>
                    <div class="text-[10px] text-[var(--color-text-dim)] truncate mt-px">{{ user.employee_id || '未设置工号' }}</div>
                  </div>

                  <!-- 操作按钮 -->
                  <div class="shrink-0 ml-1.5">
                    <!-- 已是好友 -->
                    <div
                      v-if="friendIds.has(user.id)"
                      class="w-4 h-4 rounded-full bg-green-400/10 flex items-center justify-center"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="w-2.5 h-2.5 text-green-400">
                        <path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>

                    <!-- 添加按钮 -->
                    <button
                      v-else
                      class="w-4 h-4 rounded-full flex items-center justify-center bg-[var(--color-hover-bg)] text-[var(--color-text-dim)] hover:bg-blue-500 hover:text-white active:scale-90 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-hover-bg)] disabled:hover:text-[var(--color-text-dim)] disabled:active:scale-100"
                      :disabled="addingIds.has(user.id)"
                      @click.stop="handleAdd(user)"
                    >
                      <span v-if="addingIds.has(user.id)" class="w-2 h-2 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-2.5 h-2.5">
                        <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round"/>
                        <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </TransitionGroup>
            </template>

            <!-- 搜索无结果 -->
            <div
              v-else-if="searched && !isSearching"
              class="flex flex-col items-center justify-center py-20"
            >
              <div class="w-16 h-16 rounded-2xl bg-[var(--color-hover-weak)] flex items-center justify-center mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="w-8 h-8 text-[var(--color-text-dim)]">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                  <line x1="8" y1="8" x2="14" y2="14" stroke-linecap="round"/>
                  <line x1="14" y1="8" x2="8" y2="14" stroke-linecap="round"/>
                </svg>
              </div>
              <p class="text-[14px] font-medium text-[var(--color-text-dim)] mb-1">未找到相关用户</p>
              <p class="text-[12px] text-[var(--color-text-dim)]">尝试其他昵称或工号关键词</p>
            </div>

            <!-- 初始状态 -->
            <div
              v-else
              class="flex flex-col items-center justify-center py-20"
            >
              <div class="w-16 h-16 rounded-2xl bg-[var(--color-hover-weak)] flex items-center justify-center mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="w-8 h-8 text-[var(--color-text-dim)]">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="9" cy="7" r="4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <p class="text-[14px] font-medium text-[var(--color-text-dim)] mb-1">添加新的好友</p>
              <p class="text-[12px] text-[var(--color-text-dim)] text-center leading-relaxed max-w-[260px]">
                输入昵称或工号搜索用户，<br/>或点击「查看全部用户」浏览所有注册用户
              </p>
            </div>
          </div>

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

/* ========== 卡片网格 ========== */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(142px, 1fr));
  gap: 4px;
}

/* ========== 用户卡片 ========== */
.user-card {
  display: flex;
  align-items: center;
  padding: 9px 8px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.02);
  border: 1px solid transparent;
  cursor: default;
  transition: background 0.15s, border-color 0.15s;
}
.user-card:hover {
  background: rgb(255 255 255 / 0.05);
  border-color: rgb(255 255 255 / 0.06);
}
.user-card.is-friend {
  background: rgb(74 222 128 / 0.03);
}

/* ========== 骨架卡片 ========== */
.skeleton-card {
  display: flex;
  align-items: center;
  padding: 9px 8px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.015);
  border: 1px solid rgb(255 255 255 / 0.02);
}

/* ========== 卡片进出动画 ========== */
.card-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.card-leave-active {
  transition: all 0.2s ease-in;
  position: absolute;
}
.card-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(6px);
}
.card-leave-to {
  opacity: 0;
  transform: scale(0.85);
}
.card-move {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
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
