"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  getDocument as fetchDocument,
  generateAudio,
  getAudioUrl,
} from "@/lib/api-client";
import StatusBadge from "@/components/ui/StatusBadge";
import type { DocumentStatus } from "@/types";

type DocumentDetail = {
  id: string;
  title: string;
  status: DocumentStatus;
  total_pages: number;
  raw_text: string;
  tts_text: string;
  audio_path: string | null;
  duration_sec: number | null;
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
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"raw" | "tts">("tts");

  // 音声再生
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // 処理中ならポーリング
  useEffect(() => {
    if (
      !doc ||
      (doc.status !== "generating_audio" && doc.status !== "extracting")
    )
      return;
    const interval = setInterval(fetchDoc, 3000);
    return () => clearInterval(interval);
  }, [doc, fetchDoc]);

  // 音声URL取得
  useEffect(() => {
    if (doc?.status === "completed" && doc.audio_path) {
      getAudioUrl(doc.id)
        .then((data) => setAudioUrl(data.url))
        .catch(() => {});
    }
  }, [doc]);

  async function handleGenerate() {
    if (!doc) return;
    setGenerating(true);
    setError(null);

    try {
      await generateAudio(doc.id);
      await fetchDoc();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "音声生成に失敗しました"
      );
    } finally {
      setGenerating(false);
    }
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <button
          onClick={() => router.push("/documents")}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← 一覧に戻る
        </button>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-xl font-bold">{doc.title}</h1>
          <StatusBadge status={doc.status} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {doc.total_pages}ページ | {formatTime(doc.duration_sec || 0)}
        </p>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {/* エラー表示 */}
        {(error || doc.error_message) && (
          <div className="p-4 bg-red-50 text-red-700 rounded-md">
            {error || doc.error_message}
          </div>
        )}

        {/* 音声生成ボタン */}
        {(doc.status === "extracted" || doc.status === "error") && (
          <div className="bg-white border rounded-lg p-6 text-center">
            <p className="text-gray-600 mb-4">
              テキスト抽出が完了しました。音声を生成しましょう。
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  音声生成中...しばらくお待ちください
                </span>
              ) : (
                "音声を生成する"
              )}
            </button>
          </div>
        )}

        {/* 音声生成中 */}
        {doc.status === "generating_audio" && (
          <div className="bg-white border rounded-lg p-6 text-center">
            <span className="animate-spin inline-block w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full mb-3" />
            <p className="text-gray-600">音声を生成しています...</p>
            <p className="text-sm text-gray-400 mt-1">
              ページ数やテキスト量によって数分かかることがあります
            </p>
          </div>
        )}

        {/* 音声プレーヤー */}
        {audioUrl && (
          <div className="bg-white border rounded-lg p-6">
            <h2 className="font-semibold mb-4">音声再生</h2>
            <audio
              ref={audioRef}
              src={audioUrl}
              onTimeUpdate={() =>
                setCurrentTime(audioRef.current?.currentTime || 0)
              }
              onLoadedMetadata={() =>
                setDuration(audioRef.current?.duration || 0)
              }
              onEnded={() => setIsPlaying(false)}
            />

            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="w-12 h-12 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700"
              >
                {isPlaying ? "⏸" : "▶"}
              </button>

              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
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
