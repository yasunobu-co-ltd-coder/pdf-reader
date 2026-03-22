-- =============================================
-- PDF読み上げアプリ MVP スキーマ
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- documents テーブル（MVP簡略版）
-- =============================================
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN (
      'uploaded', 'extracting', 'extracted', 'generating_audio',
      'completed', 'error'
    )),
  total_pages INTEGER NOT NULL DEFAULT 0,
  raw_text TEXT NOT NULL DEFAULT '',
  tts_text TEXT NOT NULL DEFAULT '',
  audio_path TEXT,
  duration_sec REAL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_user_created ON documents(user_id, created_at DESC);

-- =============================================
-- tts_voice_settings テーブル
-- =============================================
CREATE TABLE tts_voice_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  speaker_id INTEGER NOT NULL DEFAULT 1,
  speed_scale REAL NOT NULL DEFAULT 1.0,
  pitch_scale REAL NOT NULL DEFAULT 0.0,
  intonation_scale REAL NOT NULL DEFAULT 1.0,
  volume_scale REAL NOT NULL DEFAULT 1.0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tts_voice_settings_user_id ON tts_voice_settings(user_id);

-- =============================================
-- updated_at 自動更新トリガー
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_documents
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_tts_voice_settings
  BEFORE UPDATE ON tts_voice_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- RLS
-- =============================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tts_voice_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON documents
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "documents_insert" ON documents
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "documents_update" ON documents
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "documents_delete" ON documents
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "tts_settings_select" ON tts_voice_settings
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tts_settings_insert" ON tts_voice_settings
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "tts_settings_update" ON tts_voice_settings
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "tts_settings_delete" ON tts_voice_settings
  FOR DELETE USING (user_id = auth.uid());

-- =============================================
-- デフォルト音声設定を新規ユーザーに自動作成
-- =============================================
CREATE OR REPLACE FUNCTION create_default_voice_setting()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tts_voice_settings (user_id, is_default)
  VALUES (NEW.id, TRUE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_voice_setting();

-- =============================================
-- Storage バケット
-- =============================================
-- Supabase Dashboard または以下のSQLで作成:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('pdfs', 'pdfs', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('audio', 'audio', false);

-- Storage RLS: ユーザーは自分のフォルダのみ操作可能
-- pdfs バケット: {userId}/{documentId}/original.pdf
-- audio バケット: {userId}/{documentId}/audio.mp3
