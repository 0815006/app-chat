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

// 路由守卫：鉴权拦截
router.beforeEach(async (to, _from, next) => {
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
