-- ============================================================
-- fix_friendship_rls.sql
-- 用途：通过 SECURITY DEFINER 函数解决双向好友关系的 RLS 权限问题
-- 问题：添加好友需双向 INSERT，但 RLS 策略 auth.uid()=user_id 阻止了
--       以对方为 user_id 的反向写入，导致 403 Forbidden
-- 执行方式：在 Supabase Studio → SQL Editor 中运行
-- ============================================================

-- 1. 补充 friendships 表的 UPDATE / DELETE 策略（之前缺失）
CREATE POLICY "Users can delete own friendships"
  ON public.friendships FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- 2. 创建 SECURITY DEFINER 函数：添加好友（双向插入，绕过 RLS）
CREATE OR REPLACE FUNCTION public.add_friend(p_friend_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_profile JSONB;
BEGIN
  -- 从 JWT 获取当前用户 ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'A0001';
  END IF;
  
  -- 防止添加自己
  IF v_user_id = p_friend_id THEN
    RAISE EXCEPTION '不能添加自己为好友' USING ERRCODE = 'A0002';
  END IF;
  
  -- 检查对方是否存在
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_friend_id) THEN
    RAISE EXCEPTION '目标用户不存在' USING ERRCODE = 'A0003';
  END IF;
  
  -- 双向插入好友关系（INSERT ... ON CONFLICT DO NOTHING 防止重复）
  INSERT INTO friendships (user_id, friend_id)
  VALUES (v_user_id, p_friend_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
  
  INSERT INTO friendships (user_id, friend_id)
  VALUES (p_friend_id, v_user_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
  
  -- 返回好友资料
  SELECT jsonb_build_object(
    'id', '',
    'friend_id', p_friend_id,
    'name', nickname,
    'employee_id', employee_id,
    'avatar_url', avatar_url,
    'online', false
  )
  INTO v_profile
  FROM profiles
  WHERE id = p_friend_id;
  
  RETURN v_profile;
END;
$$;

-- 3. 创建 SECURITY DEFINER 函数：删除好友（双向删除，绕过 RLS）
CREATE OR REPLACE FUNCTION public.remove_friend(p_friend_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = 'A0001';
  END IF;
  
  -- 双向删除
  DELETE FROM friendships 
  WHERE (user_id = v_user_id AND friend_id = p_friend_id)
     OR (user_id = p_friend_id AND friend_id = v_user_id);
END;
$$;

-- 4. 先清理已存在的重复行（之前 RLS 漏洞可能导致同一对关系有多条记录）
DELETE FROM friendships a
USING friendships b
WHERE a.ctid > b.ctid
  AND a.user_id = b.user_id
  AND a.friend_id = b.friend_id;

-- 5. 添加唯一约束防止未来产生重复行
DO $$
BEGIN
  ALTER TABLE friendships ADD CONSTRAINT uq_friendship_pair UNIQUE (user_id, friend_id);
EXCEPTION WHEN duplicate_table THEN
  NULL;
END;
$$;
