import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '../types'
import { chatService } from '../services/chatService'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /** 视图层通过 authStore.user 访问当前用户 */
  const user = computed(() => currentUser.value)

  /** 登录 */
  async function login(email: string, password: string) {
    isLoading.value = true
    error.value = null
    try {
      const result = await chatService.login({ email, password })
      currentUser.value = result.user
    } catch (e) {
      error.value = e instanceof Error ? e.message : '登录失败'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  /** 注册 */
  async function register(email: string, password: string, employeeId: string, nickname: string) {
    isLoading.value = true
    error.value = null
    try {
      const result = await chatService.register({ email, password, employeeId, nickname })
      currentUser.value = result.user
    } catch (e) {
      error.value = e instanceof Error ? e.message : '注册失败'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  /** 登出 */
  async function logout() {
    error.value = null
    try {
      await chatService.logout()
    } finally {
      currentUser.value = null
    }
  }

  /** 尝试恢复会话 */
  async function restoreSession(): Promise<boolean> {
    isLoading.value = true
    try {
      const result = await chatService.restoreSession()
      if (result) {
        currentUser.value = result.user
        return true
      }
      return false
    } catch {
      return false
    } finally {
      isLoading.value = false
    }
  }

  return { currentUser, user, isLoading, error, login, register, logout, restoreSession }
})