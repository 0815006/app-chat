import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '../types'
import { chatService } from '../services'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  /** 个人信息弹窗显示状态 */
  const showProfileDialog = ref(false)

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

  /** 更新昵称 */
  async function updateProfile(nickname: string) {
    const user = await chatService.updateProfile(nickname)
    currentUser.value = user
  }

  /** 上传头像 */
  async function updateAvatar(file: File): Promise<string> {
    const url = await chatService.updateAvatar(file)
    if (currentUser.value) {
      currentUser.value = { ...currentUser.value, avatar_url: url }
    }
    return url
  }

  /** 删除头像，恢复默认无头像状态 */
  async function deleteAvatar(): Promise<string> {
    const url = await chatService.deleteAvatar()
    if (currentUser.value) {
      currentUser.value = { ...currentUser.value, avatar_url: '' }
    }
    return url
  }

  return {
    currentUser, user, isLoading, error,
    showProfileDialog,
    login, register, logout, restoreSession,
    updateProfile, updateAvatar, deleteAvatar,
  }
})