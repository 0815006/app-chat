<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import Avatar from '../../components/Avatar.vue'
import type { Friend, Group } from '../../types'

const authStore = useAuthStore()
const chatStore = useChatStore()
const searchText = ref('')

function searchFriends() {
  // 可对接搜索逻辑，当前使用 loadFriends
  chatStore.loadFriends()
}

/**
 * 获取最后一条消息的预览文本：
 * - text: 消息内容（截断30字）
 * - image: [图片]
 * - file: [文件]
 * - voice: [语音]
 */
function lastMessagePreview(lastMessage?: string, lastMessageType?: string): string {
  if (!lastMessage) return ''
  const type = lastMessageType
  if (!type || type === 'text') {
    return lastMessage.length > 30 ? lastMessage.slice(0, 30) + '…' : lastMessage
  }
  if (type === 'image') return '[图片]'
  if (type === 'file') return '[文件]'
  if (type === 'voice') return '[语音]'
  return lastMessage
}
</script>

<template>
  <aside class="grid grid-rows-[auto_1fr_auto] h-full overflow-hidden bg-[#1e1935] border-r border-[#2a1f5e]">
    <!-- 搜索栏 + 加好友 -->
    <div class="px-4 py-4 border-b border-[#2a1f5e]">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
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
        <button
          class="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[#718096] hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
          title="添加好友"
          @click="chatStore.showAddFriendDialog = true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="19" y1="13" x2="19" y2="19" stroke-linecap="round"/>
            <line x1="16" y1="16" x2="22" y2="16" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 好友列表 -->
    <div class="overflow-y-auto custom-scrollbar min-h-0">
      <!-- 加载骨架屏 -->
      <template v-if="chatStore.isLoadingFriends || chatStore.isLoadingGroups">
        <div v-for="n in 5" :key="'skel_' + n" class="flex items-center gap-3 px-4 py-2.5 mx-2 my-0.5 animate-pulse">
          <div class="w-10 h-10 rounded-full bg-[#2d3748] shrink-0"></div>
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="h-3 bg-[#2d3748] rounded w-24"></div>
            <div class="h-2.5 bg-[#2d3748] rounded w-16"></div>
          </div>
        </div>
      </template>

      <!-- ===== 群组列表 ===== -->
      <template v-if="chatStore.groups.length > 0 && !chatStore.isLoadingGroups">
        <div class="px-2 pt-2 pb-1 text-xs font-semibold text-[#718096] uppercase tracking-wider">
          群组 ({{ chatStore.groups.length }})
        </div>
        <ul class="list-none m-0 p-0">
          <li
            v-for="group in chatStore.groups"
            :key="group.id"
            class="flex items-center gap-3 px-4 py-2.5 mx-2 my-0.5 rounded-lg cursor-pointer transition-colors duration-150 hover:bg-[#252050]"
            :class="chatStore.activeGroupId === group.id ? 'bg-[#252050] text-[#e2e8f0]' : 'text-[#a0aec0]'"
            @click="chatStore.setActiveGroup(group.id)"
          >
            <!-- 群组默认图标 -->
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              :class="chatStore.activeGroupId === group.id
                ? 'bg-gradient-to-br from-purple-400 to-pink-400'
                : 'bg-[#2d284b]'"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5"
                :class="chatStore.activeGroupId === group.id ? 'text-white' : 'text-[#a0aec0]'">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between">
                <div class="text-[14px] font-medium truncate">{{ group.name }}</div>
                <span
                  v-if="(group.unread_count ?? 0) > 0"
                  class="shrink-0 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 ml-1"
                >
                  {{ (group.unread_count ?? 0) > 99 ? '99+' : group.unread_count }}
                </span>
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="text-[11px] text-[#718096]">{{ group.member_count ?? 0 }} 人</span>
                <span v-if="lastMessagePreview(group.last_message, group.last_message_type)" class="text-[12px] text-[#718096] truncate">
                  · {{ lastMessagePreview(group.last_message, group.last_message_type) }}
                </span>
              </div>
            </div>
          </li>
        </ul>
        <div class="px-2 py-2 text-xs font-semibold text-[#718096] uppercase tracking-wider">
          好友 · 在线 ({{ chatStore.onlineCount }})
        </div>
      </template>

      <template v-else>
        <div class="px-2 py-2 text-xs font-semibold text-[#718096] uppercase tracking-wider">
          在线 ({{ chatStore.onlineCount }})
        </div>
      </template>

      <!-- 好友列表项 -->
      <ul class="list-none m-0 p-0">
        <li
          v-for="friend in chatStore.friends"
          :key="friend.friend_id"
          class="flex items-center gap-3 px-4 py-2.5 mx-2 my-0.5 rounded-lg cursor-pointer transition-colors duration-150 hover:bg-[#252050]"
          :class="chatStore.activeFriendId === friend.friend_id ? 'bg-[#252050] text-[#e2e8f0]' : 'text-[#a0aec0]'"
          @click="chatStore.setActiveFriend(friend.friend_id)"
        >
          <Avatar
            :name="friend.name"
            :avatar-url="friend.avatar_url"
            :online="friend.online"
            size="md"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between">
              <div class="text-[14px] font-medium truncate">{{ friend.name }}</div>
              <!-- 未读红点 -->
              <span
                v-if="(friend.unread_count ?? 0) > 0"
                class="shrink-0 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 ml-1"
              >
                {{ (friend.unread_count ?? 0) > 99 ? '99+' : friend.unread_count }}
              </span>
            </div>
            <!-- 最后一条消息预览 -->
            <div
              v-if="lastMessagePreview(friend.last_message, friend.last_message_type)"
              class="text-[12px] text-[#718096] truncate mt-0.5"
              :class="{ 'text-[#e2e8f0]': (friend.unread_count ?? 0) > 0 }"
            >
              {{ lastMessagePreview(friend.last_message, friend.last_message_type) }}
            </div>
            <div v-else-if="friend.employee_id" class="text-[12px] text-[#718096] truncate">
              {{ friend.employee_id }}
            </div>
          </div>
        </li>
      </ul>
      <div v-if="chatStore.friends.length === 0 && chatStore.groups.length === 0 && !chatStore.isLoading && !chatStore.isLoadingGroups" class="text-center text-[13px] text-[#718096] py-8">
        暂无好友和群组
      </div>
      <div v-else-if="chatStore.friends.length === 0 && !chatStore.isLoadingFriends" class="text-center text-[13px] text-[#718096] py-8">
        暂无好友
      </div>
    </div>

    <!-- 底部当前用户 -->
    <div class="flex items-center gap-3 px-4 py-3 bg-[#17132b] border-t border-[#2a1f5e]">
      <Avatar
        :name="authStore.currentUser?.nickname ?? ''"
        :avatar-url="authStore.currentUser?.avatar_url"
        :key="authStore.currentUser?.avatar_url ?? 'no-avatar-self'"
        size="sm"
      />
      <div class="min-w-0">
        <div class="text-[13px] font-medium truncate text-[#e2e8f0]">{{ authStore.currentUser?.nickname }}</div>
        <div class="text-[11px] text-[#718096]">{{ authStore.currentUser?.employee_id }}</div>
      </div>
    </div>
  </aside>
</template>
