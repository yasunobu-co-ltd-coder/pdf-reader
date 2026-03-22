-- =============================================
-- PDF読み上げアプリ スキーマ
-- TTS構造レポート準拠 / 認証不要モード
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- documents テーブル
-- =============================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
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

CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);

-- =============================================
-- document_audio テーブル
-- ジョブ管理・ロック・進捗
-- =============================================
CREATE TABLE IF NOT EXISTS document_audio (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'processing', 'ready', 'failed')),
  speaker_id INTEGER NOT NULL DEFAULT 3,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  completed_chunks INTEGER NOT NULL DEFAULT 0,
  current_chunk_index INTEGER,
  progress_text TEXT,
  duration_sec REAL,
  error_message TEXT,

  -- ジョブロック (CAS)
  locked_by TEXT,
  processing_started_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_audio_document ON document_audio(document_id);
CREATE INDEX IF NOT EXISTS idx_document_audio_status ON document_audio(status);
CREATE INDEX IF NOT EXISTS idx_document_audio_pending ON document_audio(status, locked_by)
  WHERE status = 'generating' AND locked_by IS NULL;

-- =============================================
-- document_audio_chunks テーブル
-- =============================================
CREATE TABLE IF NOT EXISTS document_audio_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audio_id UUID NOT NULL REFERENCES document_audio(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  audio_url TEXT,
  duration_sec REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(audio_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_audio_chunks_audio_id ON document_audio_chunks(audio_id);

-- =============================================
-- tts_voice_settings テーブル
-- =============================================
CREATE TABLE IF NOT EXISTS tts_voice_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  speaker_id INTEGER NOT NULL DEFAULT 3,
  speed_scale REAL NOT NULL DEFAULT 1.0,
  pitch_scale REAL NOT NULL DEFAULT 0.0,
  intonation_scale REAL NOT NULL DEFAULT 1.0,
  volume_scale REAL NOT NULL DEFAULT 1.0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
-- RLS 無効 (認証不要モード)
-- =============================================
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_audio DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_audio_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE tts_voice_settings DISABLE ROW LEVEL SECURITY;

-- =============================================
-- Storage バケット
-- =============================================
-- Supabase Dashboard で作成:
-- 1. pdfs (private) - PDF原本
-- 2. tts-audio (public) - 生成音声WAV
--
-- パス規約:
--   pdfs:      {userId}/{uuid}/original.pdf
--   tts-audio: tts/{documentId}/{audioId}/chunk_{index}.wav
