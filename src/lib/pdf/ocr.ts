/**
 * OCR処理: スキャンPDF / 画像PDF 対応
 *
 * 処理フロー:
 * 1. PDFバイナリからJPEG画像を抽出 (FFD8...FFD9 パターン検出)
 * 2. tesseract.js で各画像をOCR (日本語 + 英語)
 * 3. 全ページのテキストを結合して返す
 */

import { createWorker, type Worker } from "tesseract.js";

/** PDFバイナリから埋め込みJPEG画像を抽出する */
export function extractJpegsFromPdf(buffer: Buffer): Buffer[] {
  const jpegs: Buffer[] = [];
  let i = 0;

  while (i < buffer.length - 2) {
    // JPEG SOI マーカー: FF D8 FF
    if (
      buffer[i] === 0xff &&
      buffer[i + 1] === 0xd8 &&
      buffer[i + 2] === 0xff
    ) {
      // JPEG EOI マーカー (FF D9) を探す
      let j = i + 3;
      while (j < buffer.length - 1) {
        if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) {
          const jpeg = buffer.subarray(i, j + 2);
          // 最低限のサイズ (小さすぎるものはサムネイルやアイコン)
          if (jpeg.length > 10000) {
            jpegs.push(Buffer.from(jpeg));
          }
          i = j + 2;
          break;
        }
        j++;
      }
      if (j >= buffer.length - 1) break;
    } else {
      i++;
    }
  }

  return jpegs;
}

/** JPEG画像配列をOCRしてテキストを返す */
export async function ocrImages(images: Buffer[]): Promise<string> {
  if (images.length === 0) return "";

  let worker: Worker | null = null;
  try {
    // tesseract.js ワーカー作成 (日本語 + 英語)
    worker = await createWorker("jpn+eng");

    const texts: string[] = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const {
          data: { text },
        } = await worker.recognize(images[i]);
        const cleaned = text.trim();
        if (cleaned.length > 0) {
          texts.push(cleaned);
        }
      } catch (err) {
        console.error(`OCR failed for image ${i}:`, err);
        // 個別画像のOCR失敗は無視して続行
      }
    }

    return texts.join("\n\n");
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // terminate失敗は無視
      }
    }
  }
}

/**
 * PDFバッファにOCRを実行
 * JPEG画像を抽出 → tesseract.js で認識
 */
export async function ocrPdf(buffer: Buffer): Promise<string> {
  console.log("[OCR] Extracting JPEG images from PDF...");
  const jpegs = extractJpegsFromPdf(buffer);
  console.log(`[OCR] Found ${jpegs.length} JPEG images`);

  if (jpegs.length === 0) {
    return "";
  }

  // 大量ページの場合は制限 (Vercel関数のタイムアウト対策)
  const MAX_OCR_PAGES = 30;
  const targets = jpegs.slice(0, MAX_OCR_PAGES);
  if (jpegs.length > MAX_OCR_PAGES) {
    console.log(
      `[OCR] Limiting to ${MAX_OCR_PAGES} pages (total: ${jpegs.length})`
    );
  }

  console.log(`[OCR] Running OCR on ${targets.length} images...`);
  const text = await ocrImages(targets);
  console.log(`[OCR] Done. Extracted ${text.length} characters`);

  return text;
}
