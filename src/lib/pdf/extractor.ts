import { PDFParse } from "pdf-parse";
import { ocrPdf } from "./ocr";
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

// テキスト抽出結果がスカスカかどうか判定する閾値
// 1ページあたり平均30文字未満 → 画像PDF扱い
const MIN_CHARS_PER_PAGE = 30;

/**
 * PDFバッファからテキストを抽出する
 * 1. まずpdf-parseでテキスト抽出を試みる
 * 2. テキストが少なければOCR (スキャンPDF/画像PDF対応)
 */
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<PdfExtractResult> {
  let parser: InstanceType<typeof PDFParse> | null = null;
  let totalPages = 0;

  try {
    // Phase 1: pdf-parse でテキスト抽出
    parser = new PDFParse(buffer);
    const result = (await parser.getText()) as unknown as TextResult;
    totalPages = result.total || 0;
    const text = result.pages.map((p) => p.text).join("\n\n").trim();

    // テキストが十分にあればそのまま返す
    const charsPerPage = totalPages > 0 ? text.length / totalPages : text.length;
    if (text.length > 0 && charsPerPage >= MIN_CHARS_PER_PAGE) {
      console.log(
        `[PDF] Text extraction OK: ${text.length} chars, ${totalPages} pages (${Math.round(charsPerPage)} chars/page)`
      );
      return { text, totalPages };
    }

    console.log(
      `[PDF] Insufficient text (${text.length} chars, ${Math.round(charsPerPage)} chars/page). Trying OCR...`
    );
  } catch (error) {
    console.log("[PDF] Text extraction failed, trying OCR...", error);
  } finally {
    if (parser) {
      try {
        parser.destroy();
      } catch {
        // destroy失敗は無視
      }
    }
  }

  // Phase 2: OCR フォールバック
  try {
    const ocrText = await ocrPdf(buffer);

    if (!ocrText || ocrText.trim().length === 0) {
      throw Errors.PDF_NO_TEXT();
    }

    // OCR結果からページ数を推定 (テキスト抽出で取れていれば使う)
    return {
      text: ocrText.trim(),
      totalPages: totalPages || 1,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "PDF_NO_TEXT"
    ) {
      throw error;
    }
    console.error("OCR error:", error);
    throw Errors.PDF_CORRUPTED();
  }
}
