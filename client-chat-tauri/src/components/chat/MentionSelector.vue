<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { GroupMember } from '../../types'
import Avatar from '../Avatar.vue'

interface Props {
  visible: boolean
  /** @ 后面输入的关键词 */
  keyword: string
  /** 群成员列表 */
  members: GroupMember[]
  /** 当前用户 ID（排除自己） */
  currentUserId: string
}

interface Emits {
  (e: 'select', memberOrAll: GroupMember | '@all'): void
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const selectedIndex = ref(0)

/** 过滤后的成员列表（排除自己） */
const filteredMembers = computed<GroupMember[]>(() => {
  const kw = props.keyword.toLowerCase().trim()
  if (!kw) {
    return props.members.filter(m => m.user_id !== props.currentUserId)
  }
  return props.members.filter(m => {
    if (m.user_id === props.currentUserId) return false
    return (m.nickname ?? '').toLowerCase().includes(kw) ||
           (m.employee_id ?? '').toLowerCase().includes(kw)
  })
})

/** @所有人 是否可见 */
const showAllItem = computed(() => true)

/** 列表总项数（用于键盘导航计算） */
const totalItems = computed(() => {
  let count = 0
  if (showAllItem.value) count++
  count += filteredMembers.value.length
  return count
})

// visible 切换时重置选中索引
watch(() => props.visible, (v) => {
  if (v) {
    selectedIndex.value = 0
  }
})

function handleSelectAll() {
  emit('select', '@all')
}

function handleSelectMember(member: GroupMember) {
  emit('select', member)
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.visible) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      selectedIndex.value = Math.min(selectedIndex.value + 1, totalItems.value - 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      break
    case 'Enter':
      e.preventDefault()
      confirmSelection()
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}

function confirmSelection() {
  if (!showAllItem.value && filteredMembers.value.length === 0) return

  let idx = selectedIndex.value

  // 如果 @所有人 可见，idx=0 对应 @所有人
  if (showAllItem.value) {
    if (idx === 0) {
      handleSelectAll()
      return
    }
    idx-- // 跳过 @所有人 项
  }

  if (idx >= 0 && idx < filteredMembers.value.length) {
    handleSelectMember(filteredMembers.value[idx])
  }
}

// 暴露 keydown 处理器给父组件（InputArea.vue）
defineExpose({ handleKeydown })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed z-[9999] w-64 max-h-56 overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] shadow-2xl"
      style="bottom: 80px; left: var(--selector-left, 16px);"
    >
      <!-- @所有人 固定项 -->
      <template v-if="showAllItem">
        <div
          class="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors"
          :class="selectedIndex === 0 ? 'bg-blue-500/20' : 'hover:bg-[var(--color-bg-hover)]'"
          @click="handleSelectAll"
          @mouseenter="selectedIndex = 0"
        >
          <span class="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/15 text-blue-400 flex-shrink-0 text-lg">
            📢
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-blue-400 truncate">@所有人</div>
            <div class="text-xs text-[var(--color-text-muted)]">通知全体群成员</div>
          </div>
        </div>

        <!-- 分隔线 -->
        <div v-if="filteredMembers.length > 0" class="mx-3 border-t border-[var(--color-border-default)]" />
      </template>

      <!-- 成员列表 -->
      <div class="overflow-y-auto custom-scrollbar max-h-44">
        <template v-if="filteredMembers.length > 0">
          <div
            v-for="(member, idx) in filteredMembers"
            :key="member.id"
            class="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors"
            :class="selectedIndex === (showAllItem ? idx + 1 : idx) ? 'bg-blue-500/20' : 'hover:bg-[var(--color-bg-hover)]'"
            @click="handleSelectMember(member)"
            @mouseenter="selectedIndex = showAllItem ? idx + 1 : idx"
          >
            <Avatar
              :avatar-url="member.avatar_url"
              :name="member.nickname ?? '?'"
              size="sm"
              :online="member.is_online"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {{ member.nickname ?? '未知用户' }}
              </div>
              <div v-if="member.employee_id" class="text-xs text-[var(--color-text-muted)]">
                {{ member.employee_id }}
              </div>
            </div>
          </div>
        </template>

        <!-- 无匹配 -->
        <div
          v-else
          class="px-3 py-4 text-center text-sm text-[var(--color-text-muted)]"
        >
          无匹配成员
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 2px;
}
</style>