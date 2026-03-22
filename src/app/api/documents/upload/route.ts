import { NextRequest } from "next/server";
import { ANONYMOUS_USER_ID } from "@/lib/db/auth";
import { createServerSupabase } from "@/lib/db/supabase";
import { createDocument, updateDocument } from "@/lib/db/documents";
import { extractTextFromPdf } from "@/lib/pdf/extractor";
import { convertRawTextToTtsText } from "@/lib/pdf/text-processor";
import { computeTextHash } from "@/lib/tts/chunk-splitter";
import { handleApiError, Errors } from "@/lib/utils/errors";

/**
 * PDFアップロード → テキスト抽出
 *
 * 2つのモードをサポート:
 * A) storage_path を POST → Supabase Storage から取得して処理 (大容量PDF対応)
 * B) FormData で file を POST → 直接処理 (4.5MB以下)
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let buffer: Buffer;
    let fileName: string;
    let storagePath: string;
    const supabase = createServerSupabase();

    if (contentType.includes("application/json")) {
      // モードA: クライアントが先にSupabase Storageへアップロード済み
      const body = await request.json();
      storagePath = body.storage_path;
      fileName = body.file_name || "document.pdf";

      if (!storagePath) {
        return Response.json(
          { data: null, error: { code: "BAD_REQUEST", message: "storage_path は必須です" } },
          { status: 400 }
        );
      }

      // Storage からダウンロード
      const { data: fileData, error: dlError } = await supabase.storage
        .from("pdfs")
        .download(storagePath);

      if (dlError || !fileData) {
        console.error("Storage download error:", dlError);
        throw Errors.INTERNAL("Storage からの取得に失敗しました");
      }

      buffer = Buffer.from(await fileData.arrayBuffer());
    } else {
      // モードB: 従来のFormDataアップロード (小さいファイル用)
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const customTitle = formData.get("title") as string | null;

      if (!file) {
        return Response.json(
          { data: null, error: { code: "NO_FILE", message: "ファイルが選択されていません" } },
          { status: 400 }
        );
      }

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        return Response.json(
          { data: null, error: { code: "INVALID_TYPE", message: "PDFファイルのみ対応しています" } },
          { status: 400 }
        );
      }

      buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;

      // Storage にアップロード
      storagePath = `${ANONYMOUS_USER_ID}/${crypto.randomUUID()}/original.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("pdfs")
        .upload(storagePath, buffer, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        throw Errors.INTERNAL("Failed to upload PDF to storage");
      }

      if (customTitle) fileName = customTitle;
    }

    // 1. PDFからテキスト抽出
    const { text: rawText, totalPages } = await extractTextFromPdf(buffer);

    // 2. ttsText変換
    const ttsText = convertRawTextToTtsText(rawText);

    // 3. タイトル決定
    const title = fileName.replace(/\.pdf$/i, "");

    // 4. DBに文書レコード作成
    const doc = await createDocument(ANONYMOUS_USER_ID, title, storagePath);

    // 5. 抽出結果を保存（text_hash付き）
    const textHash = computeTextHash(ttsText);
    const updated = await updateDocument(doc.id, {
      total_pages: totalPages,
      raw_text: rawText,
      tts_text: ttsText,
      text_hash: textHash,
      status: "extracted",
    });

    return Response.json(
      {
        data: {
          id: updated.id,
          title: updated.title,
          status: updated.status,
          total_pages: updated.total_pages,
          created_at: updated.created_at,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
