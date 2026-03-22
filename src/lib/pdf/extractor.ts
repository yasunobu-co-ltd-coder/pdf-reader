import { PDFParse } from "pdf-parse";
import { Errors } from "@/lib/utils/errors";

export interface PdfExtractResult {
  text: string;
  totalPages: number;
}

// pdf-parse v2 の getText() 戻り値型（型定義が不完全なため手動定義）
interface TextResult {
  total: number;
  pages: { text: string; num: number }[];
}

/**
 * PDFバッファからテキストを抽出する
 * pdf-parse v2 API使用
 */
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<PdfExtractResult> {
  let parser: InstanceType<typeof PDFParse> | null = null;

  try {
    // pdf-parse v2: コンストラクタにbufferを渡す
    parser = new PDFParse(buffer);

    // getText() は public メソッド
    const result = (await parser.getText()) as unknown as TextResult;

    const totalPages = result.total || 0;
    const text = result.pages.map((p) => p.text).join("\n\n");

    if (!text || text.trim().length === 0) {
      throw Errors.PDF_NO_TEXT();
    }

    return { text: text.trim(), totalPages };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "PDF_NO_TEXT"
    ) {
      throw error;
    }
    console.error("PDF parse error:", error);
    throw Errors.PDF_CORRUPTED();
  } finally {
    if (parser) {
      try {
        parser.destroy();
      } catch {
        // destroy失敗は無視
      }
    }
  }
}
