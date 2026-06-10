<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const isLogin = ref(true)
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const employeeId = ref('')
const name = ref('')
const successMsg = ref('')

const canSubmit = computed(() => {
  if (isLogin.value) {
    return email.value.trim() && password.value.trim() && !authStore.isLoading
  }
  return (
    email.value.trim() &&
    password.value.trim() &&
    confirmPassword.value === password.value &&
    employeeId.value.trim().length === 7 &&
    /^\d{7}$/.test(employeeId.value.trim()) &&
    name.value.trim() &&
    !authStore.isLoading
  )
})

function clearFields() {
  email.value = ''
  password.value = ''
  confirmPassword.value = ''
  employeeId.value = ''
  name.value = ''
  successMsg.value = ''
  authStore.error = null
}

async function handleSubmit() {
  if (!canSubmit.value) return
  successMsg.value = ''
  try {
    if (isLogin.value) {
      await authStore.login(email.value, password.value)
      await router.replace((route.query.redirect as string) ?? '/chat')
    } else {
      await authStore.register(
        email.value,
        password.value,
        employeeId.value.trim(),
        name.value.trim()
      )
      successMsg.value = '注册成功！请登录您的账号。'
      clearFields()
      isLogin.value = true
    }
  } catch {
    // store 已设置 error
  }
}
</script>

<template>
  <div class="flex h-dvh w-full bg-[#1a1a2e]">
    <!-- 左侧品牌区 -->
    <div class="hidden md:flex flex-[0_0_420px] items-center justify-center relative overflow-hidden bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(66,153,225,0.1),transparent_60%)]"></div>
      <div class="relative z-10 text-center">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-400 to-green-400 shadow-[0_8px_32px_rgba(66,153,225,0.3)] mb-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" class="w-12 h-12">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="text-4xl font-bold text-[#e2e8f0] mb-2">Chat</h1>
        <p class="text-[15px] text-[#a0aec0]">安全、即时、高效的内网聊天工具</p>
      </div>
    </div>

    <!-- 右侧表单区 -->
    <div class="flex-1 flex items-center justify-center bg-[#1a1a2e]">
      <div class="w-[380px] max-w-[90%]">
        <h2 class="text-2xl font-semibold text-[#e2e8f0] mb-1">{{ isLogin ? '欢迎回来' : '创建账号' }}</h2>
        <p class="text-sm text-[#718096] mb-7">
          {{ isLogin ? '使用邮箱登录您的账号' : '注册一个新账号开始聊天' }}
        </p>

        <!-- 成功提示 -->
        <div v-if="successMsg" class="bg-green-500/10 border border-green-500/30 text-[#6ee7b7] px-3.5 py-2.5 rounded-lg text-[13px] mb-[18px]">
          {{ successMsg }}
        </div>

        <!-- 错误提示 -->
        <div v-if="authStore.error" class="bg-red-500/10 border border-red-500/30 text-[#fc8181] px-3.5 py-2.5 rounded-lg text-[13px] mb-[18px]">
          {{ authStore.error }}
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
          <!-- 邮箱 -->
          <div class="flex flex-col gap-1.5">
            <label for="email" class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">邮箱</label>
            <input
              id="email"
              v-model="email"
              type="email"
              placeholder="user@example.com"
              autocomplete="email"
              required
              class="px-3.5 py-[11px] rounded-lg border border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
            />
          </div>

          <!-- 密码 -->
          <div class="flex flex-col gap-1.5">
            <label for="password" class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">密码</label>
            <input
              id="password"
              v-model="password"
              type="password"
              placeholder="••••••••"
              autocomplete="current-password"
              required
              class="px-3.5 py-[11px] rounded-lg border border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
            />
          </div>

          <!-- 确认密码 (仅注册) -->
          <div v-if="!isLogin" class="flex flex-col gap-1.5">
            <label for="confirm" class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">确认密码</label>
            <input
              id="confirm"
              v-model="confirmPassword"
              type="password"
              placeholder="再次输入密码"
              required
              class="px-3.5 py-[11px] rounded-lg border border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
            />
          </div>

          <!-- 工号 (仅注册) -->
          <div v-if="!isLogin" class="flex flex-col gap-1.5">
            <label for="empId" class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">工号 (7位数字)</label>
            <input
              id="empId"
              v-model="employeeId"
              type="text"
              placeholder="如 0001234"
              maxlength="7"
              pattern="\d{7}"
              required
              class="px-3.5 py-[11px] rounded-lg border border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
            />
            <span v-if="employeeId.trim() && !/^\d{7}$/.test(employeeId.trim())" class="text-[11px] text-[#fc8181]">
              工号必须为7位数字
            </span>
          </div>

          <!-- 姓名 (仅注册) -->
          <div v-if="!isLogin" class="flex flex-col gap-1.5">
            <label for="displayName" class="text-xs font-medium text-[#a0aec0] uppercase tracking-wider">姓名</label>
            <input
              id="displayName"
              v-model="name"
              type="text"
              placeholder="您的真实姓名"
              required
              class="px-3.5 py-[11px] rounded-lg border border-[#2d3748] bg-[#1e293b] text-[#e2e8f0] text-[15px] outline-none transition-colors duration-200 focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(66,153,225,0.15)] placeholder:text-[#4a5568]"
            />
          </div>

          <!-- 提交按钮 -->
          <button type="submit" class="mt-1 py-3 rounded-lg border-none bg-gradient-to-br from-blue-400 to-green-400 text-white text-[15px] font-semibold cursor-pointer transition-opacity duration-200 flex items-center justify-center gap-2 hover:opacity-90 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed" :disabled="!canSubmit">
            <span v-if="authStore.isLoading" class="w-[18px] h-[18px] border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            {{ authStore.isLoading ? '处理中...' : isLogin ? '登 录' : '注 册' }}
          </button>
        </form>

        <div class="mt-[22px] text-center text-[13px] text-[#718096]">
          <span v-if="isLogin">还没有账号？</span>
          <span v-else>已有账号？</span>
          <button class="bg-transparent border-none text-blue-400 text-[13px] cursor-pointer ml-1 underline underline-offset-2 hover:text-blue-300" @click="isLogin = !isLogin">
            {{ isLogin ? '立即注册' : '去登录' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>