import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import {
  getDocument,
  getLatestAudioForSpeaker,
  getQueueDepth,
  createAudioJob,
  insertChunkRecords,
  getChunksForAudio,
} from "@/lib/db/documents";
import { splitTextIntoChunks, computeTextHash } from "@/lib/tts/chunk-splitter";
import { handleApiError, Errors } from "@/lib/utils/errors";
import { VOICE_CHARACTERS, DEFAULT_SPEAKER_ID } from "@/types";

const QUEUE_THRESHOLD = 4;

export async function POST(request: NextRequest) {
  try {
    await getUserFromRequest(request);

    const body = await request.json();
    const { document_id, speaker_id } = body as {
      document_id: string;
      speaker_id?: number;
    };

    if (!document_id) {
      return Response.json(
        { data: null, error: { code: "BAD_REQUEST", message: "document_id は必須です" } },
        { status: 400 }
      );
    }

    // 1. 文書テキスト取得
    const doc = await getDocument(document_id);
    if (!doc) throw Errors.DOCUMENT_NOT_FOUND();
    if (!doc.tts_text || doc.tts_text.trim().length === 0) {
      return Response.json(
        { data: null, error: { code: "NO_TEXT", message: "読み上げ用テキストがありません" } },
        { status: 400 }
      );
    }

    // 2. テキストのSHA-256ハッシュ
    const textHash = computeTextHash(doc.tts_text);

    // 3. チャンク分割
    const chunks = splitTextIntoChunks(doc.tts_text);
    if (chunks.length === 0) {
      return Response.json(
        { data: null, error: { code: "NO_CHUNKS", message: "チャンク分割できませんでした" } },
        { status: 400 }
      );
    }

    // 4. キュー混雑チェック
    const queueDepth = await getQueueDepth();
    const isCongested = queueDepth >= QUEUE_THRESHOLD;

    // 5. 生成対象のspeaker_idリスト決定
    let targetSpeakers: number[];
    if (isCongested) {
      // 混雑時 → 選択中キャラのみ
      targetSpeakers = [speaker_id || DEFAULT_SPEAKER_ID];
    } else {
      // 通常時 → 全4キャラ分のジョブを一括作成
      targetSpeakers = VOICE_CHARACTERS.map((v) => v.speaker_id);
    }

    const createdJobs: { audio_id: string; speaker_id: number; status: string; reused: boolean }[] = [];

    for (const sid of targetSpeakers) {
      // 6. 既存レコード確認
      const existing = await getLatestAudioForSpeaker(document_id, sid);

      if (existing) {
        // 同じtext_hash → スキップ（failed時のみ再生成）
        if (existing.text_hash === textHash && existing.status !== "failed") {
          createdJobs.push({
            audio_id: existing.id,
            speaker_id: sid,
            status: existing.status,
            reused: true,
          });
          continue;
        }

        // 異なるtext_hash（編集後）→ 差分生成
        if (existing.text_hash !== textHash && existing.status === "ready") {
          const job = await createDiffJob(
            document_id,
            textHash,
            sid,
            chunks,
            existing.id
          );
          createdJobs.push({
            audio_id: job.id,
            speaker_id: sid,
            status: job.status,
            reused: false,
          });
          continue;
        }
      }

      // 7. 新規ジョブ作成
      const job = await createAudioJob(document_id, textHash, sid, chunks.length);

      // チャンクレコード挿入
      await insertChunkRecords(
        job.id,
        chunks.map((c) => ({ index: c.index, text: c.text }))
      );

      createdJobs.push({
        audio_id: job.id,
        speaker_id: sid,
        status: "generating",
        reused: false,
      });
    }

    return Response.json({
      data: {
        document_id,
        text_hash: textHash,
        total_chunks: chunks.length,
        queue_depth: queueDepth,
        congested: isCongested,
        jobs: createdJobs,
      },
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 差分生成: 未変更チャンクの音声URLをコピーし、変更チャンクだけ新規生成
 */
async function createDiffJob(
  documentId: string,
  textHash: string,
  speakerId: number,
  newChunks: { index: number; text: string }[],
  oldAudioId: string
) {
  const oldChunks = await getChunksForAudio(oldAudioId);

  // 旧チャンクのテキスト→URL マップ
  const oldChunkMap = new Map<string, string>();
  for (const oc of oldChunks) {
    if (oc.audio_url) {
      oldChunkMap.set(oc.chunk_text, oc.audio_url);
    }
  }

  const job = await createAudioJob(documentId, textHash, speakerId, newChunks.length);

  // チャンクレコード挿入（未変更チャンクはaudio_urlをコピー）
  const { createServerSupabase } = await import("@/lib/db/supabase");
  const supabase = createServerSupabase();

  const rows = newChunks.map((c) => {
    const existingUrl = oldChunkMap.get(c.text);
    return {
      audio_id: job.id,
      chunk_index: c.index,
      chunk_text: c.text,
      audio_url: existingUrl || null, // コピー or null（要生成）
    };
  });

  await supabase.from("document_audio_chunks").insert(rows);

  // コピー済みチャンク数をカウント
  const copiedCount = rows.filter((r) => r.audio_url !== null).length;
  if (copiedCount > 0) {
    await supabase
      .from("document_audio")
      .update({ completed_chunks: copiedCount })
      .eq("id", job.id);
  }

  return job;
}
