import { ref } from 'vue'
import { createApp } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

/** 共享响应式列表，Toast.vue 直接消费 */
export const toastList = ref<ToastItem[]>([])

export function removeToast(id: number) {
  const idx = toastList.value.findIndex((t) => t.id === id)
  if (idx !== -1) {
    toastList.value.splice(idx, 1)
  }
}

let mounted = false

async function ensureMounted(): Promise<void> {
  if (mounted) return
  mounted = true

  // 动态 import 打破循环依赖
  const { default: ToastComp } = await import('../components/Toast.vue')
  const container = document.createElement('div')
  container.id = 'toast-root'
  document.body.appendChild(container)
  createApp(ToastComp).mount(container)
}

function show(message: string, type: ToastType, duration: number): void {
  ensureMounted()
  const id = Date.now() + Math.random()
  toastList.value.push({ id, message, type })

  if (duration > 0) {
    setTimeout(() => {
      removeToast(id)
    }, duration)
  }
}

/**
 * 函数式调用 Toast 通知
 *
 * @example
 * import { toast } from '@/utils/toast'
 * toast.success('操作成功')
 * toast.error('操作失败，请重试')
 * toast.warning('请注意', 5000)
 * toast.info('提示信息')
 */
export const toast = {
  success(message: string, duration = 3000) { show(message, 'success', duration) },
  error(message: string, duration = 3000) { show(message, 'error', duration) },
  warning(message: string, duration = 3000) { show(message, 'warning', duration) },
  info(message: string, duration = 3000) { show(message, 'info', duration) },
}
