-- ============================================================
-- Chat App 数据库表结构初始化脚本
-- 用途：创建所有业务表 + 注释 + RLS 策略 + Realtime 发布
-- 执行方式：在 Supabase Studio → SQL Editor 中一次性运行
-- 注意事项：执行前请确认无重要数据，或先备份
-- ============================================================

-- 1. 先移除 messages 的 Realtime 发布（否则无法删除表）
ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;

-- 2. 按依赖顺序删除表（子表先删，父表后删）
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.friendships CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 3. 重建用户资料表
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  nickname TEXT NOT NULL,    -- 昵称，必填
  employee_id TEXT,          -- 7位工号，仅展示用
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.profiles IS '用户公开资料表';
COMMENT ON COLUMN public.profiles.id IS '用户 ID，关联 auth.users';
COMMENT ON COLUMN public.profiles.nickname IS '用户昵称（公开展示）';
COMMENT ON COLUMN public.profiles.employee_id IS '7 位工号，仅展示用，非唯一标识';
COMMENT ON COLUMN public.profiles.avatar_url IS '头像图片链接';

-- 4. 重建好友关系表（主键 UUID）
CREATE TABLE public.friendships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'accepted',
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.friendships IS '好友关系表';
COMMENT ON COLUMN public.friendships.status IS '状态：pending (申请中) / accepted (已是好友)';

-- 5. 重建聊天消息表
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  msg_type TEXT DEFAULT 'text' CHECK (msg_type IN ('text', 'image', 'file', 'voice')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.messages IS '聊天消息表';
COMMENT ON COLUMN public.messages.msg_type IS '消息类型：text | image | file | voice';
COMMENT ON COLUMN public.messages.is_read IS '接收方是否已读';
COMMENT ON COLUMN public.messages.created_at IS '消息发送时间';

-- 6. 重新开启 Realtime 实时发布
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ============================================================
-- 7. Row Level Security (RLS) 策略
-- Supabase 默认开启 RLS，必须添加策略才能正常读写
-- ============================================================

-- 7.1 profiles 表：用户可插入自己的资料（注册时写入）
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 7.2 profiles 表：用户可更新自己的资料
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 7.3 profiles 表：所有人可查看资料（公开信息）
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

-- 7.4 messages 表：发送者可插入消息
CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- 7.5 messages 表：参与对话的双方可查看消息
CREATE POLICY "Users can view their conversations"
  ON public.messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- 7.6 friendships 表：用户可插入好友关系（自己为 user_id）
CREATE POLICY "Users can insert own friendships"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 7.7 friendships 表：用户可查看自己的好友关系
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ============================================================
-- 验证：执行后可在 Studio → Table Editor 中确认各表字段
-- 再到 Authentication → Policies 中确认上述 7 条策略已生效
-- ============================================================
