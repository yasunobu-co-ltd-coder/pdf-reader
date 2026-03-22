// =============================================
// MVP データモデル型定義
// =============================================

export type DocumentStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "generating_audio"
  | "completed"
  | "error";

export type Document = {
  id: string;
  user_id: string;
  title: string;
  original_file_path: string;
  status: DocumentStatus;
  total_pages: number;
  raw_text: string;
  tts_text: string;
  audio_path: string | null;
  duration_sec: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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

// VOICEVOX API 型定義
export type VoicevoxSpeaker = {
  name: string;
  speaker_uuid: string;
  styles: {
    name: string;
    id: number;
  }[];
  version: string;
};

export type VoicevoxAudioQuery = {
  accent_phrases: {
    moras: {
      text: string;
      consonant: string | null;
      consonant_length: number | null;
      vowel: string;
      vowel_length: number;
      pitch: number;
    }[];
    accent: number;
    pause_mora: {
      text: string;
      consonant: string | null;
      consonant_length: number | null;
      vowel: string;
      vowel_length: number;
      pitch: number;
    } | null;
    is_interrogative: boolean;
  }[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLength: number | null;
  pauseLengthScale: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  kana: string;
};

// API レスポンス型
export type ApiResponse<T> = {
  data: T;
  error: null;
} | {
  data: null;
  error: { code: string; message: string };
};
