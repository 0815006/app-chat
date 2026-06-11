<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../utils/toast'

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

/** 当前头像展示：优先用本地预览，其次用远程 URL */
const avatarSrc = computed(() => {
  if (selectedFile.value) {
    return URL.createObjectURL(selectedFile.value)
  }
  return avatarPreview.value ?? null
})

/** 姓名首字母（无头像时显示） */
const initialChar = computed(() => (nickname.value[0] ?? '?').toUpperCase())

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
          class="w-[400px] max-w-[92%] bg-[#1e1935] border border-[#2a1f5e] rounded-2xl shadow-2xl overflow-hidden"
        >
          <!-- 标题栏 -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-[#2a1f5e]">
            <h3 class="text-lg font-semibold text-[#e2e8f0]">个人信息</h3>
            <button
              class="w-8 h-8 rounded-lg flex items-center justify-center text-[#718096] hover:bg-[#2a1f5e] hover:text-[#a0aec0] transition-colors cursor-pointer"
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
                class="w-24 h-24 rounded-full overflow-hidden border-2 border-[#2a1f5e]"
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
            <p v-else class="text-[11px] text-[#718096] -mt-3">点击头像更换图片</p>

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
              <label class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">昵称</label>
              <input
                v-model="nickname"
                type="text"
                placeholder="输入昵称"
                maxlength="20"
                class="w-full px-3.5 py-2.5 rounded-lg border border-[#2d3748] bg-[#17132b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
              />
            </div>

            <!-- 邮箱（只读） -->
            <div class="w-full flex flex-col gap-1.5">
              <label class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">邮箱</label>
              <input
                :value="authStore.currentUser?.email ?? ''"
                type="text"
                disabled
                class="w-full px-3.5 py-2.5 rounded-lg border border-[#2d3748] bg-[#0f0f23] text-[#718096] text-[15px] outline-none cursor-not-allowed"
              />
            </div>

            <!-- 工号（只读） -->
            <div class="w-full flex flex-col gap-1.5">
              <label class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">工号</label>
              <input
                :value="authStore.currentUser?.employee_id ?? ''"
                type="text"
                disabled
                class="w-full px-3.5 py-2.5 rounded-lg border border-[#2d3748] bg-[#0f0f23] text-[#718096] text-[15px] outline-none cursor-not-allowed"
              />
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
