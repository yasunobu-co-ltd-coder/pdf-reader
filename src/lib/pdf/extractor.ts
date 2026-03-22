import { getDocumentProxy } from "unpdf";
import { Errors } from "@/lib/utils/errors";

export interface PdfExtractResult {
  text: string;
  totalPages: number;
}

// 1ページあたり平均30文字未満 → 画像PDF扱い
const MIN_CHARS_PER_PAGE = 30;

/**
 * PDFDocumentProxy からページ単位で逐次テキスト抽出する。
 * unpdf の extractText() は Promise.all で全ページ同時ロードするため
 * 大容量PDFでメモリ不足になる。ここでは1ページずつ処理して解放する。
 */
async function extractTextSequential(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>
): Promise<string> {
  const texts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item): item is typeof item & { str: string } => "str" in item)
      .map((item) => {
        const hasEOL = "hasEOL" in item ? (item as Record<string, unknown>).hasEOL : false;
        return item.str + (hasEOL ? "\n" : "");
      })
      .join("");
    if (pageText.trim().length > 0) {
      texts.push(pageText);
    }
    page.cleanup();
  }

  return texts.join("\n");
}

/**
 * PDFバッファからテキストを抽出する
 * 1. まず unpdf でテキスト抽出を試みる（ページ単位逐次処理）
 * 2. テキストが少なければOCR (スキャンPDF/画像PDF対応)
 */
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<PdfExtractResult> {
  let totalPages = 0;
  let textExtractionFailed = false;

  try {
    // Phase 1: unpdf でテキスト抽出（ページ単位で逐次処理、メモリ効率改善）
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    totalPages = pdf.numPages;
    const text = await extractTextSequential(pdf);
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
    textExtractionFailed = true;
    console.error("[PDF] Text extraction failed:", error instanceof Error ? error.message : error);
    console.error("[PDF] Stack:", error instanceof Error ? error.stack : "N/A");
    console.error(`[PDF] Buffer size: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
  }

  // Phase 2: OCR フォールバック（動的インポートでtesseract.jsの読み込み失敗を分離）
  try {
    const { ocrPdf } = await import("./ocr");
    const ocrText = await ocrPdf(buffer);

    if (!ocrText || ocrText.trim().length === 0) {
      // unpdfがクラッシュしてOCRでもJPEGが見つからない場合は
      // テキストPDFの解析失敗（メモリ不足等）の可能性が高い
      if (textExtractionFailed) {
        throw Errors.PDF_PARSE_FAILED();
      }
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
      ((error as { code: string }).code === "PDF_NO_TEXT" ||
       (error as { code: string }).code === "PDF_PARSE_FAILED")
    ) {
      throw error;
    }
    console.error("[PDF] OCR error:", error instanceof Error ? error.message : error);
    console.error("[PDF] OCR Stack:", error instanceof Error ? error.stack : "N/A");
    // OCR自体がクラッシュした場合もリソース不足の可能性
    if (textExtractionFailed) {
      throw Errors.PDF_PARSE_FAILED();
    }
    throw Errors.PDF_NO_TEXT();
  }
}
