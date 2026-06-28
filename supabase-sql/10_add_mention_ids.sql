-- supabase-sql/10_add_mention_ids.sql
-- 为 messages 表增加 mention_ids 字段，支持群聊 @mention 功能

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mention_ids TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.messages.mention_ids
  IS '被@的用户ID数组，仅群聊消息使用；含"ALL"表示@所有人';
