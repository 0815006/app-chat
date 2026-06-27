-- 为 profiles 表新增主题偏好字段
-- 执行方式：在 Supabase SQL Editor 中运行此脚本
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';

COMMENT ON COLUMN public.profiles.theme IS '用户主题偏好：dark | light，默认 dark';
