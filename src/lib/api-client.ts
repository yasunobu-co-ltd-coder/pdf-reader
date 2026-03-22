/**
 * クライアントサイドからAPIを呼び出すヘルパー
 */

import { createBrowserSupabase } from "@/lib/db/supabase";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers,
    },
  });

  const json = await response.json();

  if (json.error) {
    throw new Error(json.error.message || "APIエラーが発生しました");
  }

  return json.data;
}

// ドキュメントAPI
export async function uploadDocument(file: File, title?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);

  return apiRequest<{
    id: string;
    title: string;
    status: string;
    total_pages: number;
  }>("/api/documents/upload", {
    method: "POST",
    body: formData,
  });
}

export async function listDocuments() {
  return apiRequest<
    {
      id: string;
      title: string;
      status: string;
      total_pages: number;
      duration_sec: number | null;
      error_message: string | null;
      created_at: string;
    }[]
  >("/api/documents/list");
}

export async function getDocument(id: string) {
  return apiRequest<{
    id: string;
    title: string;
    status: string;
    total_pages: number;
    raw_text: string;
    tts_text: string;
    audio_path: string | null;
    duration_sec: number | null;
    error_message: string | null;
    created_at: string;
  }>(`/api/documents/${id}`);
}

export async function deleteDocumentApi(id: string) {
  return apiRequest<{ deleted: boolean }>(`/api/documents/${id}`, {
    method: "DELETE",
  });
}

export async function generateAudio(id: string) {
  return apiRequest<{
    id: string;
    status: string;
    audio_path: string | null;
    duration_sec: number | null;
    chunk_count: number;
  }>(`/api/documents/${id}/generate-audio`, {
    method: "POST",
  });
}

export async function getAudioUrl(id: string) {
  return apiRequest<{ url: string }>(`/api/documents/${id}/audio`);
}

// 音声設定API
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
  return apiRequest<
    {
      name: string;
      styles: { name: string; id: number }[];
    }[]
  >("/api/voices");
}
