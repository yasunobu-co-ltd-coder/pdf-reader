import { NextRequest } from "next/server";
import {
  getAllDocuments,
  getLatestAudioForSpeaker,
  createAudioJob,
  insertChunkRecords,
} from "@/lib/db/documents";
import { splitTextIntoChunks, computeTextHash } from "@/lib/tts/chunk-splitter";
import { handleApiError } from "@/lib/utils/errors";
import { DEFAULT_SPEAKER_ID } from "@/types";

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      speaker_id = DEFAULT_SPEAKER_ID,
      batch_size = DEFAULT_BATCH_SIZE,
    } = body as { speaker_id?: number; batch_size?: number };

    const limit = Math.min(batch_size, MAX_BATCH_SIZE);

    // 音声未生成の文書を取得
    const documents = await getAllDocuments();
    const targets = documents.filter(
      (d) => d.status === "extracted" && d.tts_text && d.tts_text.trim().length > 0
    );

    let created = 0;
    const results: { document_id: string; audio_id: string }[] = [];

    for (const doc of targets) {
      if (created >= limit) break;

      const textHash = computeTextHash(doc.tts_text);
      const existing = await getLatestAudioForSpeaker(doc.id, speaker_id);

      // 既に生成済みor生成中ならスキップ
      if (existing && existing.text_hash === textHash && existing.status !== "failed") {
        continue;
      }

      const chunks = splitTextIntoChunks(doc.tts_text);
      if (chunks.length === 0) continue;

      const job = await createAudioJob(doc.id, textHash, speaker_id, chunks.length);
      await insertChunkRecords(
        job.id,
        chunks.map((c) => ({ index: c.index, text: c.text }))
      );

      results.push({ document_id: doc.id, audio_id: job.id });
      created++;
    }

    return Response.json({
      data: {
        created_jobs: created,
        total_candidates: targets.length,
        jobs: results,
      },
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
