-- ============================================================
-- add_online_status.sql
-- 用途：在 profiles 表添加 is_online 字段 + SECURITY DEFINER RPC
--       用于持久化在线状态，结合 Realtime 订阅实现实时同步
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- ============================================================

-- 1. profiles 表新增 is_online 字段（带默认值）
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.profiles.is_online IS '用户在线状态，客户端登录/登出时更新';

-- 2. 补充 profiles 表的 UPDATE 策略已存在，确认一下
--    (CREATE POLICY "Users can update own profile" 在初始化 SQL 中已定义)

-- 3. SECURITY DEFINER 函数：标记上线（绕过 RLS UPDATE 策略更可靠）
CREATE OR REPLACE FUNCTION public.go_online()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE profiles SET is_online = true, updated_at = now()
  WHERE id = auth.uid();
END;
$$;

-- 4. SECURITY DEFINER 函数：标记离线
CREATE OR REPLACE FUNCTION public.go_offline()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE profiles SET is_online = false, updated_at = now()
  WHERE id = auth.uid();
END;
$$;

-- 5. 为 Realtime 发布添加 profiles 表（监听 UPDATE 事件）
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- 6. 初始化：将所有用户设为离线（清理脏状态）
UPDATE public.profiles SET is_online = false WHERE is_online = true;
