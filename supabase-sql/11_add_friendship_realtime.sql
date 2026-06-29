-- ============================================================
-- 11_add_friendship_realtime.sql
-- 用途：将 friendships 表加入 Supabase Realtime 发布，
--       使被添加为好友的用户能实时收到通知并刷新好友列表
-- 背景：当前仅 messages 和 groups 表在 Realtime 发布中，
--       好友关系变更（别人加你为好友）前端无法实时感知
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- ============================================================

-- 1. 将 friendships 表加入 supabase_realtime 发布
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;

-- 验证说明：
-- 执行后可在 Supabase Studio → SQL Editor 中运行以下查询确认：
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   （应能看到 friendships 在列表中）
