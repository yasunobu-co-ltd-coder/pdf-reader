#!/usr/bin/env node
/**
 * VPS TTS Worker
 * Supabase の document_audio テーブルをポーリングし、
 * VOICEVOX Engine で音声を生成して Storage にアップロードする。
 *
 * 使い方:
 *   node tts-worker.js
 *   （.env を同ディレクトリに配置）
 *
 * 環境変数:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   VOICEVOX_BASE_URL  (default: http://localhost:50021)
 *   VOICEVOX_USERNAME, VOICEVOX_PASSWORD (Basic認証, 任意)
 *   POLL_INTERVAL_MS    (default: 3000)
 *   CONCURRENCY         (default: 2)
 *   STALE_TIMEOUT_MIN   (default: 10)
 *   WORKER_ID           (default: hostname-PID)
 */

const { createClient } = require("@supabase/supabase-js");
const os = require("os");
const path = require("path");

// ---------- .env 読み込み ----------
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch {
  // dotenv がなければ環境変数をそのまま使う
}

// ---------- 設定 ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOICEVOX_BASE = process.env.VOICEVOX_BASE_URL || "http://localhost:50021";
const VOICEVOX_USER = process.env.VOICEVOX_USERNAME || "";
const VOICEVOX_PASS = process.env.VOICEVOX_PASSWORD || "";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "2", 10);
const STALE_TIMEOUT_MIN = parseInt(process.env.STALE_TIMEOUT_MIN || "10", 10);
const WORKER_ID =
  process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- VOICEVOX 通信 ----------
function voicevoxAuthHeader() {
  if (!VOICEVOX_USER) return {};
  const encoded = Buffer.from(`${VOICEVOX_USER}:${VOICEVOX_PASS}`).toString(
    "base64"
  );
  return { Authorization: `Basic ${encoded}` };
}

async function audioQuery(text, speakerId) {
  const url = new URL("/audio_query", VOICEVOX_BASE);
  url.searchParams.set("text", text);
  url.searchParams.set("speaker", String(speakerId));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: voicevoxAuthHeader(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`audio_query failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function synthesis(query, speakerId) {
  const url = new URL("/synthesis", VOICEVOX_BASE);
  url.searchParams.set("speaker", String(speakerId));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...voicevoxAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`synthesis failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------- WAV duration 算出 (PCM 16bit) ----------
function wavDurationSec(buf) {
  if (buf.length < 44) return 0;
  const byteRate = buf.readUInt32LE(28);
  const dataSize = buf.length - 44;
  return byteRate > 0 ? dataSize / byteRate : 0;
}

// ---------- ジョブ取得 (CAS ロック) ----------
async function tryClaimJob() {
  // 1. まずロックされていない generating ジョブを探す
  const { data: jobs, error: findErr } = await supabase
    .from("document_audio")
    .select("id, updated_at")
    .eq("status", "generating")
    .is("locked_by", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findErr || !jobs || jobs.length === 0) return null;

  const job = jobs[0];

  // 2. CAS: updated_at が変わっていない場合のみロック取得
  const { data: claimed, error: claimErr } = await supabase
    .from("document_audio")
    .update({
      locked_by: WORKER_ID,
      processing_started_at: new Date().toISOString(),
      status: "processing",
    })
    .eq("id", job.id)
    .eq("updated_at", job.updated_at)
    .is("locked_by", null)
    .select()
    .single();

  if (claimErr || !claimed) return null; // 別 Worker に取られた
  return claimed;
}

// ---------- Stale ジョブ回復 ----------
async function recoverStaleJobs() {
  const threshold = new Date(
    Date.now() - STALE_TIMEOUT_MIN * 60 * 1000
  ).toISOString();

  const { data: stale } = await supabase
    .from("document_audio")
    .select("id")
    .eq("status", "processing")
    .lt("processing_started_at", threshold);

  if (!stale || stale.length === 0) return;

  for (const s of stale) {
    console.log(`[STALE] Releasing stale job ${s.id}`);
    await supabase
      .from("document_audio")
      .update({
        status: "generating",
        locked_by: null,
        processing_started_at: null,
      })
      .eq("id", s.id);
  }
}

// ---------- ジョブ処理 ----------
async function processJob(job) {
  const audioId = job.id;
  const speakerId = job.speaker_id;
  console.log(
    `[START] Job ${audioId} (speaker=${speakerId}, chunks=${job.total_chunks})`
  );

  try {
    // チャンク一覧取得
    const { data: chunks, error: chunkErr } = await supabase
      .from("document_audio_chunks")
      .select("*")
      .eq("audio_id", audioId)
      .order("chunk_index", { ascending: true });

    if (chunkErr || !chunks) {
      throw new Error("Failed to fetch chunks: " + (chunkErr?.message || ""));
    }

    let totalDuration = 0;
    let completed = 0;

    // 既に audio_url がある（差分生成でコピー済み）チャンクをカウント
    for (const c of chunks) {
      if (c.audio_url) {
        completed++;
        totalDuration += c.duration_sec || 0;
      }
    }

    // CONCURRENCY 並列でチャンク処理
    const pending = chunks.filter((c) => !c.audio_url);

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (chunk) => {
          const idx = chunk.chunk_index;
          const text = chunk.chunk_text;

          // 進捗更新
          await supabase
            .from("document_audio")
            .update({
              current_chunk_index: idx,
              progress_text: `${completed + 1}/${job.total_chunks} チャンク生成中`,
            })
            .eq("id", audioId);

          // VOICEVOX 2段階API
          const query = await audioQuery(text, speakerId);
          const wavBuf = await synthesis(query, speakerId);
          const dur = wavDurationSec(wavBuf);

          // Storage にアップロード
          const storagePath = `tts/${job.document_id}/${audioId}/chunk_${idx}.wav`;
          const { error: uploadErr } = await supabase.storage
            .from("tts-audio")
            .upload(storagePath, wavBuf, {
              contentType: "audio/wav",
              upsert: true,
            });

          if (uploadErr) {
            throw new Error(
              `Storage upload failed chunk ${idx}: ${uploadErr.message}`
            );
          }

          // チャンクレコード更新
          await supabase
            .from("document_audio_chunks")
            .update({
              audio_url: storagePath,
              duration_sec: dur,
            })
            .eq("id", chunk.id);

          totalDuration += dur;
          completed++;

          // audio 進捗更新
          await supabase
            .from("document_audio")
            .update({
              completed_chunks: completed,
              progress_text: `${completed}/${job.total_chunks} チャンク完了`,
            })
            .eq("id", audioId);

          console.log(
            `  [CHUNK] ${idx}/${job.total_chunks - 1} done (${dur.toFixed(1)}s)`
          );
        })
      );
    }

    // 完了
    await supabase
      .from("document_audio")
      .update({
        status: "ready",
        completed_chunks: job.total_chunks,
        duration_sec: totalDuration,
        progress_text: null,
        current_chunk_index: null,
      })
      .eq("id", audioId);

    console.log(
      `[DONE] Job ${audioId} — total ${totalDuration.toFixed(1)}s`
    );
  } catch (err) {
    console.error(`[FAIL] Job ${audioId}:`, err.message);
    await supabase
      .from("document_audio")
      .update({
        status: "failed",
        error_message: err.message?.slice(0, 500),
        locked_by: null,
      })
      .eq("id", audioId);
  }
}

// ---------- メインループ ----------
let running = true;
let activeJobs = 0;

async function pollLoop() {
  console.log(`[WORKER] ${WORKER_ID} started`);
  console.log(`  VOICEVOX: ${VOICEVOX_BASE}`);
  console.log(`  POLL: ${POLL_INTERVAL}ms, CONCURRENCY: ${CONCURRENCY}`);
  console.log(`  STALE TIMEOUT: ${STALE_TIMEOUT_MIN}min`);

  let staleCheckCounter = 0;

  while (running) {
    try {
      // 10回に1回 stale チェック
      staleCheckCounter++;
      if (staleCheckCounter >= 10) {
        await recoverStaleJobs();
        staleCheckCounter = 0;
      }

      // ジョブ取得 & 処理
      if (activeJobs === 0) {
        const job = await tryClaimJob();
        if (job) {
          activeJobs++;
          processJob(job).finally(() => {
            activeJobs--;
          });
        }
      }
    } catch (err) {
      console.error("[POLL ERROR]", err.message);
    }

    await sleep(POLL_INTERVAL);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[WORKER] Shutting down...");
  running = false;
});
process.on("SIGTERM", () => {
  console.log("[WORKER] SIGTERM received, shutting down...");
  running = false;
});

pollLoop().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
