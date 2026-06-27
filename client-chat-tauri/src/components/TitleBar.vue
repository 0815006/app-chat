<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Window } from '@tauri-apps/api/window'

/** 懒获取 Tauri 窗口实例（避免模块顶层调用时 __TAURI_INTERNALS__ 未就绪） */
let _win: Window | null = null
function getWin(): Window {
  if (!_win) {
    _win = getCurrentWindow()
  }
  return _win
}

/** 检测是否运行在 Tauri 环境 */
const isTauri = !!(window as any).__TAURI_INTERNALS__

async function minimize() {
  if (!isTauri) { console.log('[TitleBar] 非 Tauri 环境，跳过 minimize'); return }
  try { await getWin().minimize() } catch (e) { console.error('[TitleBar] minimize 失败:', e) }
}

async function maximize() {
  if (!isTauri) { console.log('[TitleBar] 非 Tauri 环境，跳过 maximize'); return }
  try { await getWin().toggleMaximize() } catch (e) { console.error('[TitleBar] maximize 失败:', e) }
}

async function close() {
  if (!isTauri) { console.log('[TitleBar] 非 Tauri 环境，跳过 close'); return }
  try { await getWin().hide() } catch (e) { console.error('[TitleBar] hide 失败:', e) }
}
</script>

<template>
  <div
    class="h-8 flex items-center justify-between select-none bg-[var(--color-bg-deepest)] shrink-0"
  >
    <!-- 拖拽区域（仅此处可拖拽窗口） -->
    <div data-tauri-drag-region class="flex-1 h-full"></div>

    <!-- 窗口控制按钮（不得嵌套在 data-tauri-drag-region 内，否则 @click 被吞） -->
    <div class="flex items-center h-full shrink-0">
      <button
        class="w-10 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
        @click="minimize"
        title="最小化"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        class="w-10 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
        @click="maximize"
        title="最大化/还原"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
      <button
        class="w-10 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-red-500/30 hover:text-[#fc8181] transition-colors cursor-pointer"
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
