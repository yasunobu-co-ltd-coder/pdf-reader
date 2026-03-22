// =============================================
// データモデル型定義
// =============================================

export type DocumentStatus = "uploaded" | "extracting" | "extracted" | "error";

export type AudioStatus = "generating" | "processing" | "ready" | "failed";

export type Document = {
  id: string;
  user_id: string;
  title: string;
  original_file_path: string;
  status: DocumentStatus;
  total_pages: number;
  raw_text: string;
  tts_text: string;
  text_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentAudio = {
  id: string;
  document_id: string;
  text_hash: string;
  status: AudioStatus;
  speaker_id: number;
  total_chunks: number;
  completed_chunks: number;
  current_chunk_index: number | null;
  progress_text: string | null;
  duration_sec: number | null;
  error_message: string | null;
  locked_by: string | null;
  processing_started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudioChunk = {
  id: string;
  audio_id: string;
  chunk_index: number;
  chunk_text: string;
  audio_url: string | null;
  duration_sec: number | null;
  created_at: string;
};

export type TTSVoiceSetting = {
  id: string;
  user_id: string;
  speaker_id: number;
  speed_scale: number;
  pitch_scale: number;
  intonation_scale: number;
  volume_scale: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

// キャラクターボイス定義
export const VOICE_CHARACTERS = [
  { speaker_id: 2, name: "四国めたん", description: "落ち着いた女性声" },
  { speaker_id: 8, name: "春日部つむぎ", description: "明るい女性声" },
  { speaker_id: 3, name: "ずんだもん", description: "親しみやすい声" },
  { speaker_id: 47, name: "ナースロボ＿タイプＴ", description: "明瞭なロボ声" },
] as const;

export const DEFAULT_SPEAKER_ID = 3;

// VOICEVOX API 型定義
export type VoicevoxSpeaker = {
  name: string;
  speaker_uuid: string;
  styles: { name: string; id: number }[];
  version: string;
};

// API レスポンス型
export type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };
