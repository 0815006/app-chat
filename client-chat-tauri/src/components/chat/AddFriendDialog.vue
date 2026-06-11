<script setup lang="ts">
import { ref, watch } from 'vue'
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../utils/toast'
import type { User } from '../../types'

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

/** 从当前 result 中已排除自己，所以统一在此过滤 */
function excludeSelf(users: User[]): User[] {
  return users.filter((u) => u.id !== authStore.currentUser?.id)
}

/** 执行搜索，仅在输入字符 >= 2 时触发 */
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
    const users = await chatStore.fetchAllUsers()
    results.value = excludeSelf(users)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '获取用户列表失败')
  } finally {
    isSearching.value = false
  }
}

/** 添加好友 */
async function handleAdd(user: User) {
  if (addingIds.value.has(user.id)) return
  addingIds.value.add(user.id)
  try {
    await chatStore.addFriend(user.id)
    toast.success(`已添加 ${user.nickname} 为好友`)
    // 从结果中移除
    results.value = results.value.filter((u) => u.id !== user.id)
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
  emit('close')
}

// 弹窗打开时自动聚焦搜索框
const inputRef = ref<HTMLInputElement | null>(null)
watch(
  () => props.visible,
  (v) => {
    if (v) {
      setTimeout(() => inputRef.value?.focus(), 100)
    }
  }
)
</script>

<template>
  <!-- 遮罩层 -->
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <!-- 半透明遮罩 -->
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        @click="close"
      ></div>

      <!-- 弹窗本体 -->
      <div
        class="relative w-[420px] max-h-[520px] rounded-2xl bg-[#1e1935] border border-[#2a1f5e] shadow-2xl flex flex-col overflow-hidden"
      >
        <!-- 标题栏 -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-[#2a1f5e] shrink-0">
          <h2 class="text-[16px] font-semibold text-[#e2e8f0]">添加好友</h2>
          <button
            class="w-8 h-8 rounded-lg flex items-center justify-center text-[#718096] hover:text-[#e2e8f0] hover:bg-[#252050] transition-colors cursor-pointer"
            @click="close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
              <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <!-- 搜索栏 -->
        <div class="px-5 py-3 border-b border-[#2a1f5e] shrink-0 flex flex-col gap-2">
          <div class="relative">
            <input
              ref="inputRef"
              v-model="keyword"
              type="text"
              placeholder="输入昵称或工号搜索..."
              class="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[#2d3748] bg-[#17132b] text-[#e2e8f0] text-[14px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
              @keyup.enter="doSearch"
              @input="searched = false; isBrowsingAll = false"
            />
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a5568] pointer-events-none"
            >
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded-md bg-blue-500/20 text-blue-400 text-[12px] font-medium hover:bg-blue-500/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="keyword.trim().length < 2 || isSearching"
              @click="doSearch"
            >
              搜索
            </button>
          </div>
          <!-- 查看所有用户按钮 -->
          <button
            class="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#ffffff06] border border-[#ffffff0d] text-[#a0aec0] text-[13px] hover:bg-[#ffffff0d] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="isSearching"
            @click="browseAllUsers"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>查看所有注册用户</span>
          </button>
        </div>

        <!-- 搜索结果区 -->
        <div class="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
          <!-- 加载中 -->
          <div v-if="isSearching" class="flex items-center justify-center py-16">
            <div class="w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"></div>
            <span class="ml-2 text-[13px] text-[#718096]">搜索中...</span>
          </div>

          <!-- 搜索结果 / 全部用户列表 -->
          <template v-else-if="results.length > 0">
            <div class="px-3 py-2 text-[11px] font-semibold text-[#718096] uppercase tracking-wider">
              {{ isBrowsingAll ? '全部用户' : '搜索结果' }} — {{ results.length }}
            </div>
            <ul class="list-none m-0 p-0">
              <li
                v-for="user in results"
                :key="user.id"
                class="flex items-center gap-3 px-3 py-2.5 mx-1 my-0.5 rounded-lg hover:bg-[#252050] transition-colors"
              >
                <!-- 头像占位 -->
                <div class="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                  {{ user.nickname.charAt(0) }}
                </div>
                <!-- 用户信息 -->
                <div class="min-w-0 flex-1">
                  <div class="text-[14px] font-medium text-[#e2e8f0] truncate">{{ user.nickname }}</div>
                  <div class="text-[11px] text-[#718096] truncate">{{ user.employee_id || '未设置工号' }}</div>
                </div>
                <!-- 添加按钮 -->
                <button
                  class="shrink-0 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-[12px] font-medium hover:bg-blue-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="addingIds.has(user.id)"
                  @click="handleAdd(user)"
                >
                  <span v-if="addingIds.has(user.id)" class="flex items-center gap-1">
                    <span class="w-3 h-3 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin"></span>
                    添加中
                  </span>
                  <span v-else>添加</span>
                </button>
              </li>
            </ul>
          </template>

          <!-- 无结果 -->
          <div
            v-else-if="searched && !isSearching"
            class="flex flex-col items-center justify-center py-16 text-[#718096]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="w-10 h-10 mb-3 opacity-40">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <span class="text-[13px]">未找到相关用户</span>
            <span class="text-[11px] mt-1 opacity-60">尝试其他昵称或工号</span>
          </div>

          <!-- 初始提示 -->
          <div
            v-else
            class="flex flex-col items-center justify-center py-16 text-[#718096]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="w-10 h-10 mb-3 opacity-40">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="text-[13px]">输入昵称或工号搜索，或点击"查看所有注册用户"</span>
          </div>
        </div>

        <!-- 底部关闭按钮 -->
        <div class="px-5 py-3 border-t border-[#2a1f5e] shrink-0 flex justify-end">
          <button
            class="px-4 py-2 rounded-lg bg-[#252050] text-[#a0aec0] text-[13px] font-medium hover:bg-[#2d1f6e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
            @click="close"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #2d3748;
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #4a5568;
}
</style>
