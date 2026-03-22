"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { listDocuments, deleteDocumentApi } from "@/lib/api-client";
import { createBrowserSupabase } from "@/lib/db/supabase";
import StatusBadge from "@/components/ui/StatusBadge";
import type { DocumentStatus } from "@/types";

type DocListItem = {
  id: string;
  title: string;
  status: DocumentStatus;
  total_pages: number;
  error_message: string | null;
  created_at: string;
};

export default function DocumentListPage() {
  const [documents, setDocuments] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchDocuments = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs as DocListItem[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // extracting 中の文書があれば5秒ごとにポーリング
  useEffect(() => {
    const hasProcessing = documents.some(
      (d) => d.status === "extracting"
    );
    if (!hasProcessing) return;

    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    try {
      await deleteDocumentApi(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">PDF読み上げ</h1>
        <div className="flex gap-3">
          <button
            onClick={() => router.push("/settings")}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            設定
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">文書一覧</h2>
          <button
            onClick={() => router.push("/documents/upload")}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            + PDFをアップロード
          </button>
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        )}

        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-md mb-4">
            {error}
          </div>
        )}

        {!loading && documents.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">文書がありません</p>
            <p className="text-sm">PDFをアップロードして読み上げを開始しましょう</p>
          </div>
        )}

        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => router.push(`/documents/${doc.id}`)}
                    className="text-left"
                  >
                    <h3 className="font-medium text-gray-900 truncate hover:text-blue-600">
                      {doc.title}
                    </h3>
                  </button>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                    <span>{doc.total_pages}ページ</span>
                    <span>{formatDate(doc.created_at)}</span>
                  </div>
                  {doc.error_message && (
                    <p className="text-sm text-red-600 mt-1">
                      {doc.error_message}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <StatusBadge status={doc.status} />
                  {doc.status === "extracted" && (
                    <button
                      onClick={() => router.push(`/documents/${doc.id}`)}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      開く
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(doc.id, doc.title)}
                    className="px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
