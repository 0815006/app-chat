import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabase 客户端单例
let supabaseInstance: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const url = import.meta.env.VITE_SUPABASE_URL as string
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

    if (!url || !key) {
      throw new Error('[Supabase] 缺少环境变量 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY，请在 .env 中配置')
    }

    supabaseInstance = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  }
  return supabaseInstance
}