<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
import Avatar from '../../components/Avatar.vue'

const authStore = useAuthStore()
</script>

<template>
  <aside
    class="flex flex-col items-center py-3 gap-1 bg-[#17132b] border-r border-[#2a1f5e]"
  >
    <!-- 后端环境指示灯（编译时静态决定，不可点击切换） -->
    <div
      class="relative w-12 h-12 rounded-2xl flex items-center justify-center bg-[#23204a] cursor-default"
      :title="'当前后端：' + (import.meta.env.VITE_BACKEND_TYPE === 'GO' ? 'Go 自建后端' : 'Supabase')"
    >
      <span class="text-lg font-bold text-[#a0aec0]">Go</span>
      <span
        class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#17132b]"
        :class="import.meta.env.VITE_BACKEND_TYPE === 'GO' ? 'bg-blue-400' : 'bg-green-400'"
      ></span>
    </div>

    <div class="w-8 h-px bg-[#2a1f5e] my-2"></div>

    <!-- 头像 -->
    <Avatar
      :name="authStore.user?.nickname ?? authStore.user?.email ?? ''"
    />

    <!-- 登出 -->
    <button
      class="w-12 h-12 rounded-2xl flex items-center justify-center text-[#718096] transition-all duration-200 cursor-pointer hover:bg-red-500/10 hover:text-[#fc8181] hover:rounded-xl mt-auto"
      title="退出登录"
      @click="authStore.logout()"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </aside>
</template>