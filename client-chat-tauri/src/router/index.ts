import { createRouter, createWebHistory } from 'vue-router'
import { getSupabase } from '../utils/supabase'

const routes = [
  {
    path: '/',
    redirect: '/login',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('../views/chat/Index.vue'),
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/** 当前是否为 Go 后端模式 */
function isGoMode(): boolean {
  return import.meta.env.VITE_BACKEND_TYPE === 'GO'
}

/** Go 模式：仅检查 localStorage 中是否存在 token（实际校验由 restoreSession 完成） */
function hasGoToken(): boolean {
  return !!localStorage.getItem('go-chat-token')
}

// 路由守卫：鉴权拦截
router.beforeEach(async (to, _from, next) => {
  // === Go 后端模式：通过 go-chat-token 鉴权 ===
  if (isGoMode()) {
    if (to.path === '/login') {
      if (hasGoToken()) return next('/chat')
      return next()
    }

    if (!hasGoToken()) return next('/login?redirect=' + to.path)
    return next()
  }

  // === Supabase 模式：通过 Supabase session 鉴权 ===
  if (to.path === '/login') {
    const supabase = getSupabase()
    const { data } = await supabase.auth.getSession()
    if (data.session) return next('/chat')
    return next()
  }

  const supabase = getSupabase()
  const { data } = await supabase.auth.getSession()
  if (!data.session) return next('/login?redirect=' + to.path)
  next()
})

export default router
