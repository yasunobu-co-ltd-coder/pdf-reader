import { createServerSupabase } from "./supabase";
import type { Document, DocumentStatus, TTSVoiceSetting } from "@/types";
import { Errors } from "@/lib/utils/errors";

function getSupabase() {
  return createServerSupabase();
}

export async function createDocument(
  userId: string,
  title: string,
  originalFilePath: string
): Promise<Document> {
  const { data, error } = await getSupabase()
    .from("documents")
    .insert({
      user_id: userId,
      title,
      original_file_path: originalFilePath,
      status: "uploaded" as DocumentStatus,
    })
    .select()
    .single();

  if (error) throw Errors.INTERNAL(error.message);
  return data as Document;
}

export async function getDocument(
  documentId: string
): Promise<Document | null> {
  const { data, error } = await getSupabase()
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error) return null;
  return data as Document;
}

export async function getDocumentsByUser(
  userId: string
): Promise<Document[]> {
  const { data, error } = await getSupabase()
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw Errors.INTERNAL(error.message);
  return (data as Document[]) || [];
}

export async function updateDocument(
  documentId: string,
  updates: Partial<
    Pick<
      Document,
      | "status"
      | "total_pages"
      | "raw_text"
      | "tts_text"
      | "audio_path"
      | "duration_sec"
      | "error_message"
      | "title"
    >
  >
): Promise<Document> {
  const { data, error } = await getSupabase()
    .from("documents")
    .update(updates)
    .eq("id", documentId)
    .select()
    .single();

  if (error) throw Errors.INTERNAL(error.message);
  return data as Document;
}

export async function deleteDocument(documentId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("documents")
    .delete()
    .eq("id", documentId);

  if (error) throw Errors.INTERNAL(error.message);
}

export async function getDefaultVoiceSetting(
  userId: string
): Promise<TTSVoiceSetting | null> {
  const { data, error } = await getSupabase()
    .from("tts_voice_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .single();

  if (error) return null;
  return data as TTSVoiceSetting;
}

export async function upsertVoiceSetting(
  userId: string,
  settings: Partial<
    Pick<
      TTSVoiceSetting,
      | "speaker_id"
      | "speed_scale"
      | "pitch_scale"
      | "intonation_scale"
      | "volume_scale"
    >
  >
): Promise<TTSVoiceSetting> {
  // まず既存のデフォルト設定を取得
  const existing = await getDefaultVoiceSetting(userId);

  if (existing) {
    const { data, error } = await getSupabase()
      .from("tts_voice_settings")
      .update(settings)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw Errors.INTERNAL(error.message);
    return data as TTSVoiceSetting;
  }

  // なければ新規作成
  const { data, error } = await getSupabase()
    .from("tts_voice_settings")
    .insert({
      user_id: userId,
      is_default: true,
      ...settings,
    })
    .select()
    .single();

  if (error) throw Errors.INTERNAL(error.message);
  return data as TTSVoiceSetting;
}
