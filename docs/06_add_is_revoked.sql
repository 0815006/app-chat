-- ============================================================
-- 06_add_is_revoked.sql
-- 用途：在 messages 表添加 is_revoked 字段，支持消息撤回功能
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- ============================================================

-- 1. messages 表新增 is_revoked 字段（布尔，撤回后置 true）
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.messages.is_revoked IS '是否已被撤回，撤回后 content 替换为 [消息已被撤回]';
