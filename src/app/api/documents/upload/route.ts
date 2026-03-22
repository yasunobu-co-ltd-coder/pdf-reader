import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { createServerSupabase } from "@/lib/db/supabase";
import { createDocument, updateDocument } from "@/lib/db/documents";
import { extractTextFromPdf } from "@/lib/pdf/extractor";
import { convertRawTextToTtsText } from "@/lib/pdf/text-processor";
import { handleApiError, Errors } from "@/lib/utils/errors";

const MAX_PDF_SIZE = (parseInt(process.env.MAX_PDF_SIZE_MB || "100")) * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const customTitle = formData.get("title") as string | null;

    if (!file) {
      return Response.json(
        { data: null, error: { code: "NO_FILE", message: "ファイルが選択されていません" } },
        { status: 400 }
      );
    }

    // バリデーション
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return Response.json(
        { data: null, error: { code: "INVALID_TYPE", message: "PDFファイルのみ対応しています" } },
        { status: 400 }
      );
    }

    if (file.size > MAX_PDF_SIZE) {
      throw Errors.PDF_TOO_LARGE();
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. PDFからテキスト抽出
    const { text: rawText, totalPages } = await extractTextFromPdf(buffer);

    // 2. ttsText変換
    const ttsText = convertRawTextToTtsText(rawText);

    // 3. タイトル決定
    const title = customTitle || file.name.replace(/\.pdf$/i, "");

    // 4. Supabase Storageにアップロード
    const supabase = createServerSupabase();
    const filePath = `${userId}/${crypto.randomUUID()}/original.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("pdfs")
      .upload(filePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw Errors.INTERNAL("Failed to upload PDF to storage");
    }

    // 5. DBに文書レコード作成
    const doc = await createDocument(userId, title, filePath);

    // 6. 抽出結果を保存
    const updated = await updateDocument(doc.id, {
      total_pages: totalPages,
      raw_text: rawText,
      tts_text: ttsText,
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
