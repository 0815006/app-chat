-- ============================================================
-- add_file_metadata.sql
-- 用途：在 messages 表添加 file_name / file_size 字段
--       支持文件消息渲染文件名和大小信息
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- ============================================================

-- 1. messages 表新增 file_name 字段（文件名，仅 file/image/voice 类型使用）
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;

COMMENT ON COLUMN public.messages.file_name IS '原始文件名，仅 file/image/voice 类型消息使用';

-- 2. messages 表新增 file_size 字段（文件字节数，用于前端展示友好大小）
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size BIGINT;

COMMENT ON COLUMN public.messages.file_size IS '文件字节数，前端用于展示友好文件大小';
