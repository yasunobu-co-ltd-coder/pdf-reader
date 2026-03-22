"use client";

import type { DocumentStatus } from "@/types";

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; color: string }
> = {
  uploaded: { label: "アップロード済み", color: "bg-gray-100 text-gray-700" },
  extracting: { label: "テキスト抽出中", color: "bg-yellow-100 text-yellow-700" },
  extracted: { label: "抽出完了", color: "bg-blue-100 text-blue-700" },
  error: { label: "エラー", color: "bg-red-100 text-red-700" },
};

export default function StatusBadge({ status }: { status: DocumentStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.error;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
    >
      {status === "extracting" && (
        <span className="mr-1 animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
      )}
      {config.label}
    </span>
  );
}
