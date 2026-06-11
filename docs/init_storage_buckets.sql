-- ============================================================
-- Supabase Storage 存储桶初始化脚本
-- 用途：创建聊天所需的 3 个公开存储桶 + RLS 策略
-- 执行方式：Supabase Studio → SQL Editor → 粘贴全部 → Run
-- ============================================================

-- 1. 创建存储桶（INSERT 到 storage.buckets 表）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('chat-images', 'chat-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']),
  ('chat-files', 'chat-files', true, 52428800, null),
  ('chat-voice', 'chat-voice', true, 5242880, ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'])
ON CONFLICT (id) DO NOTHING;

-- 2. 删除旧策略（避免重复创建报错）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Access' AND tablename = 'objects') THEN
    DROP POLICY "Public Access" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload' AND tablename = 'objects') THEN
    DROP POLICY "Authenticated users can upload" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own objects' AND tablename = 'objects') THEN
    DROP POLICY "Users can update own objects" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own objects' AND tablename = 'objects') THEN
    DROP POLICY "Users can delete own objects" ON storage.objects;
  END IF;
END $$;

-- 3. 允许所有人读取公开 Bucket
CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('chat-images', 'chat-files', 'chat-voice'));

-- 4. 仅允许已认证用户上传（无文件夹路径限制，与运维手册一致）
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id IN ('chat-images', 'chat-files', 'chat-voice')
  );

-- 5. 允许用户更新/删除自己上传的文件
CREATE POLICY "Users can update own objects"
  ON storage.objects FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND bucket_id IN ('chat-images', 'chat-files', 'chat-voice')
    AND owner = auth.uid()
  );

CREATE POLICY "Users can delete own objects"
  ON storage.objects FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND bucket_id IN ('chat-images', 'chat-files', 'chat-voice')
    AND owner = auth.uid()
  );

-- 验证
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE name IN ('chat-images', 'chat-files', 'chat-voice');
