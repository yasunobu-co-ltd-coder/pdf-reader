-- =============================================
-- PDF読み上げアプリ スキーマ
-- TTS構造レポート準拠
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- documents テーブル
-- =============================================
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'extracting', 'extracted', 'error')),
  total_pages INTEGER NOT NULL DEFAULT 0,
  raw_text TEXT NOT NULL DEFAULT '',
  tts_text TEXT NOT NULL DEFAULT '',
  text_hash TEXT,  -- SHA-256 of tts_text (差分生成用)
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_user_created ON documents(user_id, created_at DESC);

-- =============================================
-- document_audio テーブル (= minutes_audio 相当)
-- ジョブ管理・ロック・進捗
-- =============================================
CREATE TABLE document_audio (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text_hash TEXT NOT NULL,           -- 生成元テキストのSHA-256
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'processing', 'ready', 'failed')),
  speaker_id INTEGER NOT NULL DEFAULT 3,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  completed_chunks INTEGER NOT NULL DEFAULT 0,
  current_chunk_index INTEGER,       -- Worker進捗表示用
  progress_text TEXT,                -- "3/10 チャンク生成中"
  duration_sec REAL,                 -- 全チャンク合計再生時間
  error_message TEXT,

  -- ジョブロック (CAS)
  locked_by TEXT,                    -- Worker ID (hostname-PID)
  processing_started_at TIMESTAMPTZ, -- ロック取得時刻

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_audio_document ON document_audio(document_id);
CREATE INDEX idx_document_audio_status ON document_audio(status);
CREATE INDEX idx_document_audio_pending ON document_audio(status, locked_by)
  WHERE status = 'generating' AND locked_by IS NULL;

-- =============================================
-- document_audio_chunks テーブル (= minutes_audio_chunks 相当)
-- チャンク単位の音声データ
-- =============================================
CREATE TABLE document_audio_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audio_id UUID NOT NULL REFERENCES document_audio(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  audio_url TEXT,           -- Supabase Storage の署名なしパス
  duration_sec REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(audio_id, chunk_index)
);

CREATE INDEX idx_audio_chunks_audio_id ON document_audio_chunks(audio_id);

-- =============================================
-- tts_voice_settings テーブル
-- =============================================
CREATE TABLE tts_voice_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  speaker_id INTEGER NOT NULL DEFAULT 3,
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

CREATE TRIGGER set_updated_at_document_audio
  BEFORE UPDATE ON document_audio
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_tts_voice_settings
  BEFORE UPDATE ON tts_voice_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- RLS
-- =============================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_audio_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tts_voice_settings ENABLE ROW LEVEL SECURITY;

-- documents
CREATE POLICY "documents_select" ON documents
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "documents_insert" ON documents
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "documents_update" ON documents
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "documents_delete" ON documents
  FOR DELETE USING (user_id = auth.uid());

-- document_audio: 自分の文書に属するジョブのみ
CREATE POLICY "document_audio_select" ON document_audio
  FOR SELECT USING (
    document_id IN (SELECT id FROM documents WHERE user_id = auth.uid())
  );
-- Worker は service_role key で操作するため INSERT/UPDATE は RLS 不要

-- document_audio_chunks: 自分の音声ジョブに属するチャンクのみ
CREATE POLICY "audio_chunks_select" ON document_audio_chunks
  FOR SELECT USING (
    audio_id IN (
      SELECT da.id FROM document_audio da
      JOIN documents d ON da.document_id = d.id
      WHERE d.user_id = auth.uid()
    )
  );

-- tts_voice_settings
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
-- Supabase Dashboard で作成:
-- 1. pdfs (private) - PDF原本
-- 2. tts-audio (private) - 生成音声WAV
--
-- パス規約:
--   pdfs:      {userId}/{documentId}/original.pdf
--   tts-audio: tts/{documentId}/{audioId}/chunk_{index}.wav
