import { createServerSupabase } from "./supabase";
import type { Document, DocumentAudio, AudioChunk, TTSVoiceSetting } from "@/types";
import { Errors } from "@/lib/utils/errors";

function db() {
  return createServerSupabase();
}

// =============================================
// Documents
// =============================================

export async function createDocument(
  userId: string,
  title: string,
  originalFilePath: string
): Promise<Document> {
  const { data, error } = await db()
    .from("documents")
    .insert({ user_id: userId, title, original_file_path: originalFilePath, status: "uploaded" })
    .select()
    .single();
  if (error) throw Errors.INTERNAL(error.message);
  return data as Document;
}

export async function getDocument(documentId: string): Promise<Document | null> {
  const { data, error } = await db()
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();
  if (error) return null;
  return data as Document;
}

export async function getDocumentsByUser(userId: string): Promise<Document[]> {
  const { data, error } = await db()
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw Errors.INTERNAL(error.message);
  return (data as Document[]) || [];
}

/** 全文書取得（認証不要モード用） */
export async function getAllDocuments(): Promise<Document[]> {
  const { data, error } = await db()
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw Errors.INTERNAL(error.message);
  return (data as Document[]) || [];
}

export async function updateDocument(
  documentId: string,
  updates: Partial<Pick<Document, "status" | "total_pages" | "raw_text" | "tts_text" | "text_hash" | "error_message" | "title">>
): Promise<Document> {
  const { data, error } = await db()
    .from("documents")
    .update(updates)
    .eq("id", documentId)
    .select()
    .single();
  if (error) throw Errors.INTERNAL(error.message);
  return data as Document;
}

export async function deleteDocument(documentId: string): Promise<void> {
  const { error } = await db().from("documents").delete().eq("id", documentId);
  if (error) throw Errors.INTERNAL(error.message);
}

// =============================================
// Document Audio (ジョブ管理)
// =============================================

export async function createAudioJob(
  documentId: string,
  textHash: string,
  speakerId: number,
  totalChunks: number
): Promise<DocumentAudio> {
  const { data, error } = await db()
    .from("document_audio")
    .insert({
      document_id: documentId,
      text_hash: textHash,
      speaker_id: speakerId,
      total_chunks: totalChunks,
      status: "generating",
    })
    .select()
    .single();
  if (error) throw Errors.INTERNAL(error.message);
  return data as DocumentAudio;
}

export async function getAudioJobsForDocument(
  documentId: string
): Promise<DocumentAudio[]> {
  const { data, error } = await db()
    .from("document_audio")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (error) throw Errors.INTERNAL(error.message);
  return (data as DocumentAudio[]) || [];
}

export async function getAudioJob(audioId: string): Promise<DocumentAudio | null> {
  const { data, error } = await db()
    .from("document_audio")
    .select("*")
    .eq("id", audioId)
    .single();
  if (error) return null;
  return data as DocumentAudio;
}

export async function getLatestAudioForSpeaker(
  documentId: string,
  speakerId: number
): Promise<DocumentAudio | null> {
  const { data } = await db()
    .from("document_audio")
    .select("*")
    .eq("document_id", documentId)
    .eq("speaker_id", speakerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return (data as DocumentAudio) || null;
}

/**
 * キュー深さチェック: generating/processing 状態のジョブ数
 */
export async function getQueueDepth(): Promise<number> {
  const { count, error } = await db()
    .from("document_audio")
    .select("*", { count: "exact", head: true })
    .in("status", ["generating", "processing"]);
  if (error) return 0;
  return count || 0;
}

// =============================================
// Audio Chunks
// =============================================

export async function insertChunkRecords(
  audioId: string,
  chunks: { index: number; text: string }[]
): Promise<void> {
  const rows = chunks.map((c) => ({
    audio_id: audioId,
    chunk_index: c.index,
    chunk_text: c.text,
  }));
  const { error } = await db().from("document_audio_chunks").insert(rows);
  if (error) throw Errors.INTERNAL(error.message);
}

export async function getChunksForAudio(audioId: string): Promise<AudioChunk[]> {
  const { data, error } = await db()
    .from("document_audio_chunks")
    .select("*")
    .eq("audio_id", audioId)
    .order("chunk_index", { ascending: true });
  if (error) throw Errors.INTERNAL(error.message);
  return (data as AudioChunk[]) || [];
}

// =============================================
// Voice Settings
// =============================================

export async function getDefaultVoiceSetting(userId: string): Promise<TTSVoiceSetting | null> {
  const { data } = await db()
    .from("tts_voice_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .single();
  return (data as TTSVoiceSetting) || null;
}

export async function upsertVoiceSetting(
  userId: string,
  settings: Partial<Pick<TTSVoiceSetting, "speaker_id" | "speed_scale" | "pitch_scale" | "intonation_scale" | "volume_scale">>
): Promise<TTSVoiceSetting> {
  const existing = await getDefaultVoiceSetting(userId);
  if (existing) {
    const { data, error } = await db()
      .from("tts_voice_settings")
      .update(settings)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw Errors.INTERNAL(error.message);
    return data as TTSVoiceSetting;
  }
  const { data, error } = await db()
    .from("tts_voice_settings")
    .insert({ user_id: userId, is_default: true, ...settings })
    .select()
    .single();
  if (error) throw Errors.INTERNAL(error.message);
  return data as TTSVoiceSetting;
}
