/**
 * クライアントサイドからAPIを呼び出すヘルパー
 * 認証不要モード: Authorizationヘッダーなし
 */

import { createBrowserSupabase } from "@/lib/db/supabase";

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...options?.headers },
  });

  // サーバーが500でHTMLを返す場合の対策
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `サーバーエラー (${response.status}): レスポンスがJSONではありません。Vercelログを確認してください。`
    );
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || "APIエラーが発生しました");
  }
  return json.data;
}

// =============================================
// Documents API
// =============================================

/**
 * PDFアップロード
 * Vercelの4.5MBボディ制限を回避するため、
 * クライアントから直接Supabase Storageにアップロードし、
 * APIルートにはパスだけ送る
 */
export async function uploadDocument(file: File, title?: string) {
  const supabase = createBrowserSupabase();

  // 1. Supabase Storage に直接アップロード
  const userId = "00000000-0000-0000-0000-000000000000";
  const storagePath = `${userId}/${crypto.randomUUID()}/original.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`ストレージアップロード失敗: ${uploadError.message}`);
  }

  // 2. APIルートにパスを送信してテキスト抽出
  return apiRequest<{
    id: string;
    title: string;
    status: string;
    total_pages: number;
  }>("/api/documents/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storage_path: storagePath,
      file_name: title || file.name,
    }),
  });
}

export async function listDocuments() {
  return apiRequest<{
    id: string;
    title: string;
    status: string;
    total_pages: number;
    error_message: string | null;
    created_at: string;
  }[]>("/api/documents/list");
}

export async function getDocument(id: string) {
  return apiRequest<{
    id: string;
    title: string;
    status: string;
    total_pages: number;
    raw_text: string;
    tts_text: string;
    text_hash: string | null;
    error_message: string | null;
    created_at: string;
  }>(`/api/documents/${id}`);
}

export async function deleteDocumentApi(id: string) {
  return apiRequest<{ deleted: boolean }>(`/api/documents/${id}`, { method: "DELETE" });
}

// =============================================
// TTS API
// =============================================

export async function generateTts(documentId: string, speakerId?: number) {
  return apiRequest<{
    document_id: string;
    text_hash: string;
    total_chunks: number;
    queue_depth: number;
    congested: boolean;
    jobs: {
      audio_id: string;
      speaker_id: number;
      status: string;
      reused: boolean;
    }[];
  }>("/api/tts/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId, speaker_id: speakerId }),
  });
}

export type TtsStatusResponse = {
  audio_id?: string;
  status: string;
  speaker_id: number;
  total_chunks: number;
  completed_chunks: number;
  current_chunk_index: number | null;
  progress_text: string | null;
  duration_sec: number | null;
  error_message: string | null;
  chunks: {
    chunk_index: number;
    chunk_text: string;
    audio_url: string | null;
    duration_sec: number | null;
  }[];
};

export async function getTtsStatus(documentId: string, speakerId: number) {
  return apiRequest<TtsStatusResponse>(
    `/api/tts/status?document_id=${documentId}&speaker_id=${speakerId}`
  );
}

// =============================================
// Voice Settings API
// =============================================

export async function getVoiceSetting() {
  return apiRequest<{
    id: string;
    speaker_id: number;
    speed_scale: number;
    pitch_scale: number;
    intonation_scale: number;
    volume_scale: number;
  } | null>("/api/voice-settings");
}

export async function saveVoiceSetting(settings: {
  speaker_id?: number;
  speed_scale?: number;
  pitch_scale?: number;
  intonation_scale?: number;
  volume_scale?: number;
}) {
  return apiRequest("/api/voice-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function getVoices() {
  return apiRequest<{
    name: string;
    styles: { name: string; id: number }[];
  }[]>("/api/voices");
}
