-- =============================================
-- 認証機構の削除マイグレーション
-- Supabase SQL Editor で実行
-- =============================================

-- 1. FK制約を削除
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_user_id_fkey;
ALTER TABLE tts_voice_settings DROP CONSTRAINT IF EXISTS tts_voice_settings_user_id_fkey;

-- 2. user_id にデフォルト値を設定
ALTER TABLE documents ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE tts_voice_settings ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- 3. RLS 無効化 (テーブル)
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_audio DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_audio_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE tts_voice_settings DISABLE ROW LEVEL SECURITY;

-- 4. 既存の RLS ポリシーを削除
DROP POLICY IF EXISTS "documents_select" ON documents;
DROP POLICY IF EXISTS "documents_insert" ON documents;
DROP POLICY IF EXISTS "documents_update" ON documents;
DROP POLICY IF EXISTS "documents_delete" ON documents;
DROP POLICY IF EXISTS "document_audio_select" ON document_audio;
DROP POLICY IF EXISTS "audio_chunks_select" ON document_audio_chunks;
DROP POLICY IF EXISTS "tts_settings_select" ON tts_voice_settings;
DROP POLICY IF EXISTS "tts_settings_insert" ON tts_voice_settings;
DROP POLICY IF EXISTS "tts_settings_update" ON tts_voice_settings;
DROP POLICY IF EXISTS "tts_settings_delete" ON tts_voice_settings;

-- 5. auth.users トリガーを削除
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS create_default_voice_setting();

-- 6. 既存データの user_id を匿名ユーザーに統一
UPDATE documents SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id != '00000000-0000-0000-0000-000000000000';
UPDATE tts_voice_settings SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id != '00000000-0000-0000-0000-000000000000';

-- =============================================
-- Storage: pdfs バケットの匿名アップロード許可
-- (クライアントから anon key で直接アップロードするため)
-- =============================================

-- pdfs バケットへの匿名 INSERT を許可
CREATE POLICY "anon_upload_pdfs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'pdfs');

-- pdfs バケットの読み取りを許可 (service_role で使うが念のため)
CREATE POLICY "anon_read_pdfs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pdfs');

-- tts-audio バケットの公開読み取りを許可
CREATE POLICY "public_read_tts_audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tts-audio');

-- tts-audio バケットへのアップロード (service_role 用、ポリシーがあると安全)
CREATE POLICY "service_upload_tts_audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tts-audio');
