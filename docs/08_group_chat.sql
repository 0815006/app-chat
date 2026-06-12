-- ============================================================
-- 08_group_chat.sql
-- 用途：创建群组聊天支持所需的表、扩展字段、RLS 策略和 Realtime 发布
-- 执行方式：在 Supabase Studio → SQL Editor 中一次性运行
-- 前提：已执行 01_init_database.sql 和 07_fix_revoke_realtime.sql
-- ============================================================

-- 1. 创建群组表
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.groups IS '群组表';
COMMENT ON COLUMN public.groups.id IS '群组 ID (UUID)';
COMMENT ON COLUMN public.groups.name IS '群组名称';
COMMENT ON COLUMN public.groups.avatar_url IS '群头像 URL';
COMMENT ON COLUMN public.groups.owner_id IS '群主用户 ID';

-- 2. 创建群成员表
CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

COMMENT ON TABLE public.group_members IS '群成员关系表';
COMMENT ON COLUMN public.group_members.group_id IS '群组 ID';
COMMENT ON COLUMN public.group_members.user_id IS '成员用户 ID';
COMMENT ON COLUMN public.group_members.role IS '角色：owner（群主）| admin（管理员）| member（普通成员）';

-- 3. 为 messages 表添加 group_id 字段（群聊消息使用）
--    群聊消息：group_id 非空，receiver_id 设为 sender_id（满足原有 FK 约束）
--    单聊消息：group_id 为 NULL，行为完全不变
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.messages.group_id IS '群聊消息对应的群组 ID，单聊时为 NULL';

-- 4. 创建索引加速群消息查询
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON public.messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_created ON public.messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON public.group_members(user_id);

-- ============================================================
-- 5. Row Level Security (RLS) 策略
-- ============================================================

-- 5.1 groups 表：所有人可查看群组信息（公开）
CREATE POLICY "Groups are viewable by everyone"
  ON public.groups FOR SELECT
  USING (true);

-- 5.2 groups 表：登录用户可创建群组
CREATE POLICY "Users can create groups"
  ON public.groups FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- 5.3 groups 表：群主可更新群组信息
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'groups'
      AND policyname = 'Owner can update group'
  ) THEN
    CREATE POLICY "Owner can update group"
      ON public.groups FOR UPDATE
      USING (auth.uid() = owner_id)
      WITH CHECK (auth.uid() = owner_id);
  END IF;
END $$;

-- 5.4 group_members 表：所有人可查看群成员
CREATE POLICY "Group members are viewable by everyone"
  ON public.group_members FOR SELECT
  USING (true);

-- 5.5 group_members 表：群组成员关系由服务端 RPC 管理（SECURITY DEFINER 函数）
--     注意：不允许客户端直接 INSERT/DELETE group_members，
--     必须通过 RPC 函数 add_group_member / remove_group_member 操作

-- 5.6 更新 messages SELECT 策略：群成员可以查看本群的消息
DROP POLICY IF EXISTS "Users can view their conversations" ON public.messages;
CREATE POLICY "Users can view their conversations"
  ON public.messages FOR SELECT
  USING (
    auth.uid() = sender_id
    OR auth.uid() = receiver_id
    OR (
      group_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = messages.group_id
          AND gm.user_id = auth.uid()
      )
    )
  );

-- 5.7 更新 messages INSERT 策略：允许发送群消息（group_id 非空时 receiver_id 为 sender_id）
DROP POLICY IF EXISTS "Users can insert own messages" ON public.messages;
CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      -- 单聊：receiver_id 是合法接收者
      (group_id IS NULL AND EXISTS (SELECT 1 FROM public.friendships f WHERE f.user_id = auth.uid() AND f.friend_id = receiver_id))
      OR
      -- 群聊：group_id 非空且当前用户是该群成员
      (group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = messages.group_id AND gm.user_id = auth.uid()))
    )
  );

-- ============================================================
-- 6. RPC 函数：创建群组（原子操作：建群 + 拉人 + 群主加入）
--    SECURITY DEFINER 绕过 RLS 对 group_members 的限制
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_group(
  p_name TEXT,
  p_member_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id UUID;
  v_owner_id UUID;
  v_member_id UUID;
  v_result JSONB;
BEGIN
  -- 获取当前用户
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  -- 1. 创建群组
  INSERT INTO public.groups (name, owner_id)
  VALUES (p_name, v_owner_id)
  RETURNING id INTO v_group_id;

  -- 2. 群主加入 group_members
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group_id, v_owner_id, 'owner');

  -- 3. 添加其他成员
  FOREACH v_member_id IN ARRAY p_member_ids
  LOOP
    -- 避免重复添加群主
    IF v_member_id != v_owner_id THEN
      INSERT INTO public.group_members (group_id, user_id, role)
      VALUES (v_group_id, v_member_id, 'member');
    END IF;
  END LOOP;

  -- 返回创建的群组信息
  SELECT jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'avatar_url', g.avatar_url,
    'owner_id', g.owner_id,
    'created_at', g.created_at
  ) INTO v_result
  FROM public.groups g
  WHERE g.id = v_group_id;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 7. RPC 函数：添加群成员
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_group_member(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 检查调用者是否为群主或管理员
  SELECT gm.role INTO v_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid();

  IF v_role IS NULL OR (v_role != 'owner' AND v_role != 'admin') THEN
    RAISE EXCEPTION '仅群主和管理员可以拉人进群';
  END IF;

  -- 添加成员
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (p_group_id, p_user_id, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 8. RPC 函数：移除群成员 / 退出群聊
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  -- 获取调用者角色
  SELECT gm.role INTO v_caller_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid();

  -- 自己退出群聊（任何成员都可以）
  IF p_user_id = auth.uid() AND v_caller_role IS NOT NULL THEN
    -- 群主不能直接退群（需要先转让群主或解散群）
    IF v_caller_role = 'owner' THEN
      RAISE EXCEPTION '群主不能直接退出，请先转让群主或解散群';
    END IF;
    DELETE FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id;
    RETURN jsonb_build_object('success', true, 'action', 'leave');
  END IF;

  -- 踢人：需要权限检查
  SELECT gm.role INTO v_target_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id;

  IF v_caller_role IS NULL OR v_target_role IS NULL THEN
    RAISE EXCEPTION '无权限操作';
  END IF;

  -- 群主可以踢任何人，管理员只能踢普通成员
  IF v_caller_role = 'owner' OR (v_caller_role = 'admin' AND v_target_role = 'member') THEN
    -- 不能踢自己（已在上面处理）
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION '不能踢自己';
    END IF;
    DELETE FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id;
    RETURN jsonb_build_object('success', true, 'action', 'kick');
  ELSE
    RAISE EXCEPTION '没有踢人权限';
  END IF;
END;
$$;

-- ============================================================
-- 9. RPC 函数：解散群组（仅群主可操作）
-- ============================================================
CREATE OR REPLACE FUNCTION public.dissolve_group(
  p_group_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 检查调用者是否为群主
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION '仅群主可以解散群';
  END IF;

  -- CASCADE 删除会自动清理 group_members 和 messages
  DELETE FROM public.groups WHERE id = p_group_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 10. 开启 Realtime 发布（groups 和 group_members 变更广播）
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'groups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
  END IF;
END $$;

-- ============================================================
-- 验证：
--   SELECT * FROM pg_policies WHERE tablename IN ('groups', 'group_members', 'messages');
--   SELECT * FROM pg_publication_tables WHERE schemaname = 'public';
--   SELECT * FROM public.groups;
--   SELECT * FROM public.group_members;
-- ============================================================
