<script setup lang="ts">
import { computed } from 'vue'
import { toastList, removeToast, type ToastType } from '../utils/toast'

const typeIcons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const typeColors: Record<ToastType, string> = {
  success: 'border-green-400/40 bg-green-400/10 text-green-300',
  error: 'border-red-400/40 bg-red-400/10 text-red-300',
  warning: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-300',
  info: 'border-blue-400/40 bg-blue-400/10 text-blue-300',
}

const items = computed(() => toastList.value)
</script>

<template>
  <Teleport to="body">
    <div class="fixed z-[9999] top-[64px] left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none" :style="{ gap: '8px' }">
      <TransitionGroup name="toast">
        <div
          v-for="item in items"
          :key="item.id"
          class="pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium shadow-lg backdrop-blur-sm cursor-pointer select-none"
          :class="typeColors[item.type]"
          @click="removeToast(item.id)"
        >
          <span
            class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            :class="{
              'bg-green-400 text-black': item.type === 'success',
              'bg-red-400 text-white': item.type === 'error',
              'bg-yellow-400 text-black': item.type === 'warning',
              'bg-blue-400 text-white': item.type === 'info',
            }"
          >
            {{ typeIcons[item.type] }}
          </span>
          <span class="whitespace-nowrap">{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}
</style>
