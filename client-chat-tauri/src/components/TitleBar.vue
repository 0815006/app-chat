<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'

const appWindow = getCurrentWindow()

async function minimize() {
  await appWindow.minimize()
}

async function maximize() {
  await appWindow.toggleMaximize()
}

async function close() {
  await appWindow.close()
}
</script>

<template>
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 h-8 z-50 flex items-center justify-between select-none bg-[#0f0f23]"
  >
    <!-- 拖拽区域 -->
    <div data-tauri-drag-region class="flex-1 h-full"></div>

    <!-- 窗口控制按钮 -->
    <div class="flex items-center h-full shrink-0">
      <button
        class="w-10 h-full flex items-center justify-center text-[#718096] hover:bg-[#ffffff0a] hover:text-[#a0aec0] transition-colors cursor-pointer"
        @click="minimize"
        title="最小化"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        class="w-10 h-full flex items-center justify-center text-[#718096] hover:bg-[#ffffff0a] hover:text-[#a0aec0] transition-colors cursor-pointer"
        @click="maximize"
        title="最大化/还原"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
      <button
        class="w-10 h-full flex items-center justify-center text-[#718096] hover:bg-red-500/30 hover:text-[#fc8181] transition-colors cursor-pointer"
        @click="close"
        title="关闭"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>
