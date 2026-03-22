import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { getLatestAudioForSpeaker, getChunksForAudio } from "@/lib/db/documents";
import { handleApiError } from "@/lib/utils/errors";

export async function GET(request: NextRequest) {
  try {
    await getUserFromRequest(request);

    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("document_id");
    const speakerId = parseInt(searchParams.get("speaker_id") || "3");

    if (!documentId) {
      return Response.json(
        { data: null, error: { code: "BAD_REQUEST", message: "document_id は必須です" } },
        { status: 400 }
      );
    }

    const audio = await getLatestAudioForSpeaker(documentId, speakerId);

    if (!audio) {
      return Response.json({
        data: {
          status: "not_generated",
          speaker_id: speakerId,
          chunks: [],
          total_chunks: 0,
          completed_chunks: 0,
          duration_sec: null,
        },
        error: null,
      });
    }

    // チャンク情報取得（audio_url付き）
    const chunks = await getChunksForAudio(audio.id);

    return Response.json({
      data: {
        audio_id: audio.id,
        status: audio.status,
        speaker_id: audio.speaker_id,
        total_chunks: audio.total_chunks,
        completed_chunks: audio.completed_chunks,
        current_chunk_index: audio.current_chunk_index,
        progress_text: audio.progress_text,
        duration_sec: audio.duration_sec,
        error_message: audio.error_message,
        chunks: chunks.map((c) => ({
          chunk_index: c.chunk_index,
          chunk_text: c.chunk_text,
          audio_url: c.audio_url,
          duration_sec: c.duration_sec,
        })),
      },
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
