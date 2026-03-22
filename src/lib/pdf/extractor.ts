import { extractText, getDocumentProxy } from "unpdf";
import { Errors } from "@/lib/utils/errors";

export interface PdfExtractResult {
  text: string;
  totalPages: number;
}

// 1ページあたり平均30文字未満 → 画像PDF扱い
const MIN_CHARS_PER_PAGE = 30;

/**
 * PDFバッファからテキストを抽出する
 * 1. まず unpdf でテキスト抽出を試みる
 * 2. テキストが少なければOCR (スキャンPDF/画像PDF対応)
 */
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<PdfExtractResult> {
  let totalPages = 0;

  try {
    // Phase 1: unpdf でテキスト抽出（サーバーレス環境対応、ポリフィル不要）
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    totalPages = pdf.numPages;
    const { text } = await extractText(pdf, { mergePages: true });
    const trimmed = text.trim();

    // テキストが十分にあればそのまま返す
    const charsPerPage = totalPages > 0 ? trimmed.length / totalPages : trimmed.length;
    if (trimmed.length > 0 && charsPerPage >= MIN_CHARS_PER_PAGE) {
      console.log(
        `[PDF] Text extraction OK: ${trimmed.length} chars, ${totalPages} pages (${Math.round(charsPerPage)} chars/page)`
      );
      await pdf.destroy();
      return { text: trimmed, totalPages };
    }

    console.log(
      `[PDF] Insufficient text (${trimmed.length} chars, ${Math.round(charsPerPage)} chars/page). Trying OCR...`
    );
    await pdf.destroy();
  } catch (error) {
    console.error("[PDF] Text extraction failed:", error instanceof Error ? error.message : error);
    console.error("[PDF] Stack:", error instanceof Error ? error.stack : "N/A");
  }

  // Phase 2: OCR フォールバック（動的インポートでtesseract.jsの読み込み失敗を分離）
  try {
    const { ocrPdf } = await import("./ocr");
    const ocrText = await ocrPdf(buffer);

    if (!ocrText || ocrText.trim().length === 0) {
      throw Errors.PDF_NO_TEXT();
    }

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
    console.error("[PDF] OCR error:", error instanceof Error ? error.message : error);
    console.error("[PDF] OCR Stack:", error instanceof Error ? error.stack : "N/A");
    throw Errors.PDF_NO_TEXT();
  }
}
