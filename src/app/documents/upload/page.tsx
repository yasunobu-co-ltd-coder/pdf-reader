"use client";

export const dynamic = "force-dynamic";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadDocument } from "@/lib/api-client";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFileSelect(f: File) {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("PDFファイルのみ対応しています");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      setError("ファイルサイズが100MBを超えています");
      return;
    }
    setFile(f);
    setError(null);
    if (!title) {
      setTitle(f.name.replace(/\.pdf$/i, ""));
    }
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const result = await uploadDocument(file, title || undefined);
      router.push(`/documents/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 sm:px-6 py-4">
        <button
          onClick={() => router.push("/documents")}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← 一覧に戻る
        </button>
        <h1 className="text-xl font-bold mt-1">PDFアップロード</h1>
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        {/* ドロップゾーン */}
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-50"
              : file
                ? "border-green-400 bg-green-50"
                : "border-gray-300 hover:border-gray-400"
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile) handleFileSelect(droppedFile);
          }}
        >
          <input
            ref={inputRef}
            id="pdf-file-input"
            name="pdf-file"
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />

          {file ? (
            <div>
              <p className="text-green-700 font-medium">{file.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
              <p className="text-sm text-gray-400 mt-2">
                クリックして別のファイルを選択
              </p>
            </div>
          ) : (
            <div>
              <p className="text-gray-600 text-lg mb-2">
                PDFファイルをドラッグ&ドロップ
              </p>
              <p className="text-gray-400 text-sm">
                またはクリックして選択（最大100MB）
              </p>
            </div>
          )}
        </div>

        {/* タイトル */}
        <div className="mt-6">
          <label htmlFor="pdf-title" className="block text-sm font-medium text-gray-700 mb-1">
            タイトル（任意）
          </label>
          <input
            id="pdf-title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ファイル名から自動設定"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* アップロードボタン */}
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="mt-6 w-full py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          {uploading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              アップロード中...テキスト抽出しています
            </span>
          ) : (
            "アップロードしてテキスト抽出"
          )}
        </button>

        <p className="mt-3 text-xs text-gray-400 text-center">
          テキストPDF・画像PDF（スキャン）対応。OCRで自動テキスト抽出します。
        </p>
        <p className="mt-1 text-xs text-gray-300 text-center font-mono">
          build: {process.env.NEXT_PUBLIC_BUILD_ID || "dev"}
        </p>
      </main>
    </div>
  );
}
