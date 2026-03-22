import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import {
  getDocument,
  updateDocument,
  getDefaultVoiceSetting,
} from "@/lib/db/documents";
import { createServerSupabase } from "@/lib/db/supabase";
import { generateVoiceForDocument } from "@/lib/tts/generator";
import { handleApiError, Errors } from "@/lib/utils/errors";
import type { TTSVoiceSetting } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserFromRequest(request);
    const { id } = await params;
    const doc = await getDocument(id);

    if (!doc) {
      throw Errors.DOCUMENT_NOT_FOUND();
    }

    if (!doc.tts_text || doc.tts_text.trim().length === 0) {
      return Response.json(
        {
          data: null,
          error: {
            code: "NO_TEXT",
            message: "読み上げ用テキストがありません",
          },
        },
        { status: 400 }
      );
    }

    // ステータスを更新
    await updateDocument(id, { status: "generating_audio", error_message: null });

    // 音声設定を取得
    let voiceSetting = await getDefaultVoiceSetting(userId);

    if (!voiceSetting) {
      // デフォルト設定がなければ仮のものを使う
      voiceSetting = {
        id: "",
        user_id: userId,
        speaker_id: 1,
        speed_scale: 1.0,
        pitch_scale: 0.0,
        intonation_scale: 1.0,
        volume_scale: 1.0,
        is_default: true,
        created_at: "",
        updated_at: "",
      } satisfies TTSVoiceSetting;
    }

    // 音声生成（これがメイン処理、時間がかかる）
    let result;
    try {
      result = await generateVoiceForDocument(doc.tts_text, voiceSetting);
    } catch (genError) {
      console.error("Audio generation failed:", genError);
      await updateDocument(id, {
        status: "error",
        error_message: "音声生成に失敗しました",
      });
      throw Errors.VOICEVOX_GENERATION_FAILED();
    }

    // Supabase Storageに保存
    const supabase = createServerSupabase();
    const audioPath = `${userId}/${id}/audio.wav`;

    const { error: uploadError } = await supabase.storage
      .from("audio")
      .upload(audioPath, result.audioBuffer, {
        contentType: "audio/wav",
        upsert: true,
      });

    if (uploadError) {
      console.error("Audio upload error:", uploadError);
      await updateDocument(id, {
        status: "error",
        error_message: "音声ファイルの保存に失敗しました",
      });
      throw Errors.INTERNAL("Failed to upload audio");
    }

    // 完了状態に更新
    const updated = await updateDocument(id, {
      status: "completed",
      audio_path: audioPath,
      duration_sec: result.durationSec,
    });

    return Response.json({
      data: {
        id: updated.id,
        status: updated.status,
        audio_path: updated.audio_path,
        duration_sec: updated.duration_sec,
        chunk_count: result.chunkCount,
      },
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
