"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  getDocument as fetchDocument,
  generateTts,
  getTtsStatus,
  type TtsStatusResponse,
} from "@/lib/api-client";
import StatusBadge from "@/components/ui/StatusBadge";
import type { DocumentStatus } from "@/types";
import { DEFAULT_SPEAKER_ID } from "@/types";

type DocumentDetail = {
  id: string;
  title: string;
  status: DocumentStatus;
  total_pages: number;
  raw_text: string;
  tts_text: string;
  text_hash: string | null;
  error_message: string | null;
  created_at: string;
};

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"raw" | "tts">("tts");

  // TTS 状態
  const speakerId = DEFAULT_SPEAKER_ID; // ずんだもん固定
  const [ttsStatus, setTtsStatus] = useState<TtsStatusResponse | null>(null);
  const [generating, setGenerating] = useState(false);

  // 音声再生 (チャンク単位)
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [chunkDuration, setChunkDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- ドキュメント取得 ----------
  const fetchDoc = useCallback(async () => {
    try {
      const data = await fetchDocument(id);
      setDoc(data as DocumentDetail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  // ---------- TTS ステータスポーリング ----------
  const fetchTtsStatus = useCallback(async () => {
    if (!doc) return;
    try {
      const status = await getTtsStatus(doc.id, speakerId);
      setTtsStatus(status);
    } catch {
      // サイレント
    }
  }, [doc, speakerId]);

  // 初回 & speakerId 変更時に取得
  useEffect(() => {
    if (doc) fetchTtsStatus();
  }, [doc, speakerId, fetchTtsStatus]);

  // generating/processing 中は2秒ポーリング
  useEffect(() => {
    if (
      ttsStatus &&
      (ttsStatus.status === "generating" || ttsStatus.status === "processing")
    ) {
      pollingRef.current = setInterval(fetchTtsStatus, 2000);
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
  }, [ttsStatus?.status, fetchTtsStatus]);

  // ---------- 音声生成リクエスト ----------
  async function handleGenerate() {
    if (!doc) return;
    setGenerating(true);
    setError(null);
    try {
      await generateTts(doc.id, speakerId);
      await fetchTtsStatus();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "音声生成リクエストに失敗しました"
      );
    } finally {
      setGenerating(false);
    }
  }

  // ---------- チャンク音声再生 ----------
  const playableChunks =
    ttsStatus?.chunks.filter((c) => c.audio_url) || [];
  const totalDuration =
    ttsStatus?.duration_sec ||
    playableChunks.reduce((s, c) => s + (c.duration_sec || 0), 0);

  // 累計時間を計算 (シークバー用)
  const chunkStartTimes = playableChunks.reduce<number[]>((acc, c, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (playableChunks[i - 1].duration_sec || 0));
    return acc;
  }, []);

  const globalTime =
    (chunkStartTimes[currentChunkIndex] || 0) + currentTime;

  function getAudioSrc(chunkIndex: number): string | null {
    const chunk = playableChunks[chunkIndex];
    if (!chunk?.audio_url) return null;
    // Supabase Storage public URL
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return `${supabaseUrl}/storage/v1/object/public/tts-audio/${chunk.audio_url}`;
  }

  function playChunk(index: number) {
    if (index >= playableChunks.length) {
      setIsPlaying(false);
      setCurrentChunkIndex(0);
      setCurrentTime(0);
      return;
    }
    setCurrentChunkIndex(index);
    const src = getAudioSrc(index);
    if (!src || !audioRef.current) return;
    audioRef.current.src = src;
    audioRef.current.playbackRate = playbackRate;
    audioRef.current.play().catch(() => {});
    setIsPlaying(true);

    // preload next
    if (index + 1 < playableChunks.length) {
      const nextSrc = getAudioSrc(index + 1);
      if (nextSrc) {
        const preload = new Audio(nextSrc);
        preload.preload = "auto";
      }
    }
  }

  function handleChunkEnded() {
    playChunk(currentChunkIndex + 1);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (playableChunks.length > 0) {
      if (audioRef.current.src && audioRef.current.currentTime > 0) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        playChunk(currentChunkIndex);
      }
    }
  }

  function handleGlobalSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const targetTime = parseFloat(e.target.value);
    // どのチャンクに該当するか探す
    let idx = 0;
    let elapsed = 0;
    for (let i = 0; i < playableChunks.length; i++) {
      const dur = playableChunks[i].duration_sec || 0;
      if (elapsed + dur > targetTime) {
        idx = i;
        break;
      }
      elapsed += dur;
      if (i === playableChunks.length - 1) idx = i;
    }
    const offset = targetTime - elapsed;
    if (idx !== currentChunkIndex) {
      setCurrentChunkIndex(idx);
      const src = getAudioSrc(idx);
      if (src && audioRef.current) {
        audioRef.current.src = src;
        audioRef.current.currentTime = Math.max(0, offset);
        if (isPlaying) audioRef.current.play().catch(() => {});
      }
    } else if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, offset);
    }
    setCurrentTime(Math.max(0, offset));
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ---------- レンダリング ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600">{error || "文書が見つかりません"}</p>
      </div>
    );
  }

  const isReady = ttsStatus?.status === "ready";
  const isInProgress =
    ttsStatus?.status === "generating" || ttsStatus?.status === "processing";
  const isFailed = ttsStatus?.status === "failed";
  const notGenerated =
    !ttsStatus || ttsStatus.status === "not_generated";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 sm:px-6 py-4">
        <button
          onClick={() => router.push("/documents")}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          &larr; 一覧に戻る
        </button>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-xl font-bold">{doc.title}</h1>
          <StatusBadge status={doc.status} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {doc.total_pages}ページ
        </p>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* エラー表示 */}
        {(error || doc.error_message) && (
          <div className="p-4 bg-red-50 text-red-700 rounded-md">
            {error || doc.error_message}
          </div>
        )}

        {/* 音声生成 */}
        {doc.status === "extracted" && (
          <div className="bg-white border rounded-lg p-4 sm:p-6">
            <h2 className="font-semibold mb-4">音声生成</h2>

            {/* 生成ボタン / 状態表示 */}
            {notGenerated || isFailed ? (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    リクエスト送信中...
                  </span>
                ) : isFailed ? (
                  "再生成する"
                ) : (
                  "音声を生成する"
                )}
              </button>
            ) : null}

            {isFailed && ttsStatus?.error_message && (
              <p className="mt-2 text-sm text-red-600">
                {ttsStatus.error_message}
              </p>
            )}
          </div>
        )}

        {/* 生成中プログレス */}
        {isInProgress && ttsStatus && (
          <div className="bg-white border rounded-lg p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="animate-spin inline-block w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
              <span className="font-medium">
                {ttsStatus.progress_text || "音声を生成しています..."}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    ttsStatus.total_chunks > 0
                      ? (ttsStatus.completed_chunks / ttsStatus.total_chunks) *
                        100
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {ttsStatus.completed_chunks} / {ttsStatus.total_chunks} チャンク完了
            </p>
          </div>
        )}

        {/* 音声プレーヤー (Early Playback: 1つでもチャンクがあれば再生可能) */}
        {playableChunks.length > 0 && (
          <div className="bg-white border rounded-lg p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">音声再生</h2>
              {isInProgress && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                  Early Playback
                </span>
              )}
            </div>

            <audio
              ref={audioRef}
              onTimeUpdate={() =>
                setCurrentTime(audioRef.current?.currentTime || 0)
              }
              onLoadedMetadata={() =>
                setChunkDuration(audioRef.current?.duration || 0)
              }
              onEnded={handleChunkEnded}
            />

            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 flex-shrink-0"
              >
                {isPlaying ? "⏸" : "▶"}
              </button>

              <div className="flex-1 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={totalDuration || 0}
                  step={0.1}
                  value={globalTime}
                  onChange={handleGlobalSeek}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{formatTime(globalTime)}</span>
                  <span>{formatTime(totalDuration)}</span>
                </div>
              </div>
            </div>

            {/* 倍速ボタン */}
            <div className="flex gap-2 mt-3">
              {[1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => {
                    setPlaybackRate(rate);
                    if (audioRef.current) audioRef.current.playbackRate = rate;
                  }}
                  className={`flex-1 py-2 text-sm rounded font-medium transition ${
                    playbackRate === rate
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* チャンクリスト */}
            <div className="mt-4 max-h-60 overflow-y-auto space-y-1">
              {playableChunks.map((chunk, i) => (
                <button
                  key={chunk.chunk_index}
                  onClick={() => playChunk(i)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                    i === currentChunkIndex && isPlaying
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <span className="text-gray-400 mr-2">
                    {chunk.chunk_index + 1}.
                  </span>
                  <span className="truncate">
                    {chunk.chunk_text.slice(0, 60)}
                    {chunk.chunk_text.length > 60 ? "..." : ""}
                  </span>
                  {chunk.duration_sec != null && (
                    <span className="float-right text-gray-400">
                      {formatTime(chunk.duration_sec)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* テキスト表示 */}
        <div className="bg-white border rounded-lg">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab("tts")}
              className={`px-4 py-3 text-sm font-medium ${
                activeTab === "tts"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              読み上げ用テキスト
            </button>
            <button
              onClick={() => setActiveTab("raw")}
              className={`px-4 py-3 text-sm font-medium ${
                activeTab === "raw"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              原文テキスト
            </button>
          </div>
          <div className="p-6">
            <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed max-h-[600px] overflow-y-auto">
              {activeTab === "tts" ? doc.tts_text : doc.raw_text}
            </pre>
          </div>
        </div>
      </main>
    </div>
  );
}
