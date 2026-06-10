<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'

const authStore = useAuthStore()
const chatStore = useChatStore()
const searchText = ref('')

function searchFriends() {
  // 可对接搜索逻辑，当前使用 loadFriends
  chatStore.loadFriends()
}
</script>

<template>
  <aside class="flex flex-col bg-[#1e1935] border-r border-[#2a1f5e]">
    <!-- 搜索栏 -->
    <div class="px-4 py-4 border-b border-[#2a1f5e]">
      <div class="relative">
        <input
          v-model="searchText"
          type="text"
          placeholder="搜索好友..."
          class="w-full pl-9 pr-3 py-2 rounded-lg border border-[#2d3748] bg-[#17132b] text-[#e2e8f0] text-[14px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
          @keyup.enter="searchFriends"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a5568] pointer-events-none">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
      </div>
    </div>

    <!-- 好友列表 -->
    <div class="flex-1 overflow-y-auto custom-scrollbar">
      <!-- 加载骨架屏 -->
      <template v-if="chatStore.isLoadingFriends">
        <div v-for="n in 5" :key="'skel_' + n" class="flex items-center gap-3 px-4 py-2.5 mx-2 my-0.5 animate-pulse">
          <div class="w-10 h-10 rounded-full bg-[#2d3748] shrink-0"></div>
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="h-3 bg-[#2d3748] rounded w-24"></div>
            <div class="h-2.5 bg-[#2d3748] rounded w-16"></div>
          </div>
        </div>
      </template>

      <div class="px-2 py-2 text-xs font-semibold text-[#718096] uppercase tracking-wider">
        在线 — {{ chatStore.onlineCount }}
      </div>
      <ul class="list-none m-0 p-0">
        <li
          v-for="friend in chatStore.friends"
          :key="friend.friend_id"
          class="flex items-center gap-3 px-4 py-2.5 mx-2 my-0.5 rounded-lg cursor-pointer transition-colors duration-150 hover:bg-[#252050]"
          :class="chatStore.activeFriendId === friend.friend_id ? 'bg-[#252050] text-[#e2e8f0]' : 'text-[#a0aec0]'"
          @click="chatStore.setActiveFriend(friend.friend_id)"
        >
          <div class="relative shrink-0">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center text-white text-sm font-semibold">
              {{ friend.name.charAt(0) }}
            </div>
            <span
              class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#1e1935]"
              :class="friend.online ? 'bg-green-400' : 'bg-[#4a5568]'"
            ></span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[14px] font-medium truncate">{{ friend.name }}</div>
            <div class="text-[12px] text-[#718096] truncate">{{ friend.employee_id }}</div>
          </div>
          <div
            v-if="chatStore.unreadCounts[friend.friend_id]"
            class="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1"
          >
            {{ chatStore.unreadCounts[friend.friend_id] > 99 ? '99+' : chatStore.unreadCounts[friend.friend_id] }}
          </div>
        </li>
      </ul>
      <div v-if="chatStore.friends.length === 0 && !chatStore.isLoading" class="text-center text-[13px] text-[#718096] py-8">
        暂无好友
      </div>
    </div>

    <!-- 底部当前用户 -->
    <div class="flex items-center gap-3 px-4 py-3 bg-[#17132b] border-t border-[#2a1f5e]">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center text-white text-xs font-semibold shrink-0">
        {{ (authStore.currentUser?.nickname ?? '?').charAt(0) }}
      </div>
      <div class="min-w-0">
        <div class="text-[13px] font-medium truncate text-[#e2e8f0]">{{ authStore.currentUser?.nickname }}</div>
        <div class="text-[11px] text-[#718096]">{{ authStore.currentUser?.employee_id }}</div>
      </div>
    </div>
  </aside>
</template>