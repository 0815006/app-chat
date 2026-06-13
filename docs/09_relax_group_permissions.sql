-- ============================================================
-- 09_relax_group_permissions.sql
-- 用途：
--   1. 放宽 add_group_member RPC — 任何群成员均可邀请（不再限制仅群主/管理员）
--   2. 新增 update_group_name RPC — 任何群成员均可修改群名
--   3. 新增 groups 表 UPDATE RLS 策略 — 群成员可更新群信息
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- 前提：已执行 08_group_chat.sql
-- ============================================================

-- 1. 放宽 add_group_member RPC：任何群成员均可拉人进群
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
  -- 检查调用者是否为群成员（任何角色均可邀请）
  SELECT gm.role INTO v_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION '你不是该群成员，无法邀请';
  END IF;

  -- 添加成员
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (p_group_id, p_user_id, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 2. 新增 update_group_name RPC：任何群成员均可修改群名
CREATE OR REPLACE FUNCTION public.update_group_name(
  p_group_id UUID,
  p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_exists BOOLEAN;
BEGIN
  -- 检查调用者是否为群成员
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
  ) INTO v_member_exists;

  IF NOT v_member_exists THEN
    RAISE EXCEPTION '你不是该群成员，无法修改群名';
  END IF;

  -- 更新群名
  UPDATE public.groups SET name = p_name WHERE id = p_group_id;

  RETURN jsonb_build_object('success', true, 'name', p_name);
END;
$$;

-- 3. 新增 groups 表 UPDATE RLS 策略：群成员可更新群信息（兜底，RPC 已绕过 RLS）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'groups'
      AND policyname = 'Members can update group info'
  ) THEN
    CREATE POLICY "Members can update group info"
      ON public.groups FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = groups.id
            AND gm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = groups.id
            AND gm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 验证：
--   SELECT * FROM pg_policies WHERE tablename = 'groups';
--   SELECT proname FROM pg_proc WHERE proname IN ('add_group_member', 'update_group_name');
