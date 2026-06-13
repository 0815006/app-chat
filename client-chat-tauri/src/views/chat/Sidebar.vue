<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'

import Avatar from '../../components/Avatar.vue'

const router = useRouter()
const authStore = useAuthStore()
const chatStore = useChatStore()

const backendType = import.meta.env.VITE_BACKEND_TYPE as 'SUPABASE' | 'GO'
const backendLabel = backendType === 'GO' ? 'Go 自建后端' : 'Supabase'

/** 退出登录并跳转到登录页 */
async function handleLogout() {
  await authStore.logout()
  chatStore.resetAll()
  router.replace('/login')
}
</script>

<template>
  <aside
    class="flex flex-col items-center py-3 gap-1 bg-[#17132b] border-r border-[#2a1f5e]"
  >
    <!-- 后端环境指示灯（编译时静态决定，不可点击切换） -->
    <div
      class="relative w-12 h-12 rounded-2xl flex items-center justify-center bg-[#23204a] cursor-default"
      :title="'当前后端：' + backendLabel"
    >
      <span class="text-lg font-bold text-[#a0aec0]">Go</span>
      <span
        class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#17132b]"
        :class="backendType === 'GO' ? 'bg-blue-400' : 'bg-green-400'"
      ></span>
    </div>

    <div class="w-8 h-px bg-[#2a1f5e] my-2"></div>

    <!-- 创建群聊 -->
    <button
      class="w-12 h-12 rounded-2xl flex items-center justify-center text-[#718096] transition-all duration-200 cursor-pointer hover:bg-purple-500/10 hover:text-purple-400 hover:rounded-xl"
      title="创建群聊"
      @click="chatStore.showCreateGroupDialog = true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="9" cy="7" r="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- 头像（点击弹出个人信息弹窗） -->
    <!-- 直接使用 currentUser 而非 user computed，确保头像 URL 更新后立即响应 -->
    <Avatar
      :name="authStore.currentUser?.nickname ?? authStore.currentUser?.email ?? ''"
      :avatar-url="authStore.currentUser?.avatar_url"
      :key="authStore.currentUser?.avatar_url ?? 'no-avatar'"
      clickable
      @click="authStore.showProfileDialog = true"
    />

    <!-- 退出登录（mt-auto 推至底部，与 FriendList 用户信息行对齐） -->
    <button
      class="w-12 h-12 rounded-2xl flex items-center justify-center text-[#718096] transition-all duration-200 cursor-pointer hover:bg-red-500/10 hover:text-[#fc8181] hover:rounded-xl mt-auto"
      title="退出登录"
      @click="handleLogout"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </aside>
</template>