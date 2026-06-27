<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../utils/toast'
import { resolveFileUrl } from '../../utils/fileUrl'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const authStore = useAuthStore()

const nickname = ref('')
const avatarPreview = ref<string | null>(null)
const isUploading = ref(false)
const isSaving = ref(false)
const isDeleting = ref(false)
const selectedFile = ref<File | null>(null)

/** 从 authStore 同步当前资料 */
watch(
  () => [props.visible, authStore.currentUser],
  ([vis]) => {
    if (vis && authStore.currentUser) {
      nickname.value = authStore.currentUser.nickname ?? ''
      avatarPreview.value = authStore.currentUser.avatar_url ?? null
      selectedFile.value = null
    }
  },
  { immediate: true }
)

/** 当前头像展示：优先用本地预览，其次用远程 URL（Go 相对路径经 resolveFileUrl 拼接） */
const avatarSrc = computed(() => {
  if (selectedFile.value) {
    return URL.createObjectURL(selectedFile.value)
  }
  return resolveFileUrl(avatarPreview.value)
})

/** 姓名首字母（无头像时显示） */
const initialChar = computed(() => (nickname.value[0] ?? '?').toUpperCase())

/** 当前主题 */
const currentTheme = computed<'dark' | 'light'>(() => authStore.currentUser?.theme ?? 'dark')
const themeChanging = ref(false)

async function toggleTheme() {
  const next = currentTheme.value === 'dark' ? 'light' : 'dark'
  themeChanging.value = true
  try {
    await authStore.setTheme(next)
    toast.success(`已切换为${next === 'dark' ? '深色' : '浅色'}主题`)
  } catch (e) {
    toast.error('主题切换失败')
  } finally {
    themeChanging.value = false
  }
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (file.size > 5 * 1024 * 1024) {
    toast.error('头像图片不能超过 5MB')
    input.value = ''
    return
  }
  if (!file.type.startsWith('image/')) {
    toast.error('仅支持图片格式')
    input.value = ''
    return
  }

  selectedFile.value = file
}

/** 上传头像 */
async function uploadAvatar() {
  if (!selectedFile.value) return
  isUploading.value = true
  try {
    const newUrl = await authStore.updateAvatar(selectedFile.value)
    avatarPreview.value = newUrl
    selectedFile.value = null
    toast.success('头像已更新')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '头像上传失败')
  } finally {
    isUploading.value = false
  }
}

/** 保存昵称 */
async function saveProfile() {
  const trimmed = nickname.value.trim()
  if (!trimmed) {
    toast.error('昵称不能为空')
    return
  }
  isSaving.value = true
  try {
    await authStore.updateProfile(trimmed)
    toast.success('个人信息已更新')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '更新个人信息失败')
  } finally {
    isSaving.value = false
  }
}

/** 删除头像，恢复默认无头像状态 */
async function removeAvatar() {
  isDeleting.value = true
  try {
    await authStore.deleteAvatar()
    avatarPreview.value = null
    selectedFile.value = null
    toast.success('头像已删除')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '删除头像失败')
  } finally {
    isDeleting.value = false
  }
}

function close() {
  // 释放本地预览的 object URL
  if (selectedFile.value) {
    URL.revokeObjectURL(URL.createObjectURL(selectedFile.value))
    selectedFile.value = null
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="close"
      >
        <div
          class="w-[400px] max-w-[92%] bg-[var(--color-bg-dialog)] border border-[var(--color-border-strong)] rounded-2xl shadow-2xl overflow-hidden"
        >
          <!-- 标题栏 -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-strong)]">
            <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">个人信息</h3>
            <button
              class="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-hover-strong)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
              @click="close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
                <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <!-- 内容区 -->
          <div class="px-5 py-6 flex flex-col items-center gap-5">
            <!-- 头像 -->
            <div class="relative group cursor-pointer" @click="($refs.fileInput as HTMLInputElement)?.click()">
              <div
                v-if="avatarSrc"
                class="w-24 h-24 rounded-full overflow-hidden border-2 border-[var(--color-border-strong)]"
              >
                <img :src="avatarSrc" alt="头像" class="w-full h-full object-cover" />
              </div>
              <div
                v-else
                class="w-24 h-24 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-green-400 text-white text-3xl font-bold"
              >
                {{ initialChar }}
              </div>
              <!-- 悬浮覆盖层 -->
              <div
                class="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" class="w-6 h-6">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="handleFileChange"
            />

            <!-- 上传按钮（选文件后显示） -->
            <button
              v-if="selectedFile"
              class="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500/80 hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isUploading"
              @click="uploadAvatar"
            >
              {{ isUploading ? '上传中...' : '上传头像' }}
            </button>
            <p v-else class="text-[11px] text-[var(--color-text-muted)] -mt-3">点击头像更换图片</p>

            <!-- 删除头像按钮（有头像时显示） -->
            <button
              v-if="avatarPreview && !selectedFile"
              class="px-4 py-1.5 rounded-lg text-sm font-medium text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isDeleting"
              @click="removeAvatar"
            >
              {{ isDeleting ? '删除中...' : '删除头像' }}
            </button>

            <!-- 昵称 -->
            <div class="w-full flex flex-col gap-1.5">
              <label class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">昵称</label>
              <input
                v-model="nickname"
                type="text"
                placeholder="输入昵称"
                maxlength="20"
                class="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[var(--color-text-disabled)]"
              />
            </div>

            <!-- 邮箱（只读） -->
            <div class="w-full flex flex-col gap-1.5">
              <label class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">邮箱</label>
              <input
                :value="authStore.currentUser?.email ?? ''"
                type="text"
                disabled
                class="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-deepest)] text-[var(--color-text-muted)] text-[15px] outline-none cursor-not-allowed"
              />
            </div>

            <!-- 工号（只读） -->
            <div class="w-full flex flex-col gap-1.5">
              <label class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">工号</label>
              <input
                :value="authStore.currentUser?.employee_id ?? ''"
                type="text"
                disabled
                class="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-deepest)] text-[var(--color-text-muted)] text-[15px] outline-none cursor-not-allowed"
              />
            </div>

            <!-- 主题切换 -->
            <div class="w-full flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">主题</span>
                <span class="text-[11px] text-[var(--color-text-muted)]">{{ currentTheme === 'dark' ? '深色模式' : '浅色模式' }}</span>
              </div>
              <button
                class="relative w-14 h-7 rounded-full transition-colors duration-250 cursor-pointer border-none outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                :class="currentTheme === 'dark' ? 'bg-[var(--color-border-default)]' : 'bg-[var(--color-border-strong)]'"
                :disabled="themeChanging"
                @click="toggleTheme"
              >
                <span
                  class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-250 flex items-center justify-center"
                  :class="currentTheme === 'dark' ? 'translate-x-[28px]' : 'translate-x-[2px]'"
                >
                  <!-- 月亮图标（当前深色模式） -->
                  <svg v-if="currentTheme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" class="w-4 h-4">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <!-- 太阳图标（当前浅色模式） -->
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" class="w-4 h-4">
                    <circle cx="12" cy="12" r="5"/>
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke-linecap="round"/>
                  </svg>
                </span>
              </button>
            </div>

            <!-- 保存按钮 -->
            <button
              class="w-full py-2.5 rounded-lg border-none bg-gradient-to-br from-blue-400 to-green-400 text-white text-[15px] font-semibold cursor-pointer transition-opacity duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isSaving || !nickname.trim()"
              @click="saveProfile"
            >
              {{ isSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
