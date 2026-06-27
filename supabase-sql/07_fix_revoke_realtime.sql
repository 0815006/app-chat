-- ============================================================
-- 07_fix_revoke_realtime.sql
-- 用途：修复撤回消息在接收者侧不实时消失的问题
-- 问题根因：
--   1. messages 表缺少 REPLICA IDENTITY FULL，
--      导致 Supabase Realtime 的 UPDATE 事件 payload.new
--      可能不包含完整字段（is_revoked 等），接收者无法识别撤回
--   2. messages 表缺少 UPDATE 的 RLS 策略，
--      发送者调用 revokeMessage 时若 RLS 开启则 UPDATE 被拒绝
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- ============================================================

-- 1. 设置 REPLICA IDENTITY FULL，确保 UPDATE 事件携带完整行数据
--    这是接收者能实时收到撤回通知的关键修复
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- 2. 添加 UPDATE 的 RLS 策略：发送者可以更新自己发送的消息（用于撤回）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages'
      AND policyname = 'Users can update own messages'
  ) THEN
    CREATE POLICY "Users can update own messages"
      ON public.messages FOR UPDATE
      USING (auth.uid() = sender_id)
      WITH CHECK (auth.uid() = sender_id);
  END IF;
END $$;

-- 验证说明：
-- 执行后可在 Supabase Studio → SQL Editor 中运行以下查询确认：
--   SELECT relname, relreplident FROM pg_class WHERE relname = 'messages';
--   （relreplident = 'f' 表示 FULL，'d' 表示 DEFAULT）
--   SELECT * FROM pg_policies WHERE tablename = 'messages';
--   （应看到新增的 "Users can update own messages" 策略）
