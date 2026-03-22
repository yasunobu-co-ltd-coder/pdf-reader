/**
 * TTS チャンクスプリッター
 * TTS構造レポート準拠: TARGET 250文字, HARD_MAX 350文字
 */

import { createHash } from "crypto";

const TARGET_CHUNK_SIZE = 250;
const HARD_MAX = 350;
const MIN_CHUNK_SIZE = 20;

export interface TtsChunk {
  index: number;
  text: string;
}

/**
 * テキストの SHA-256 ハッシュを生成
 */
export function computeTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * テキストをTTSチャンクに分割する
 */
export function splitTextIntoChunks(text: string): TtsChunk[] {
  const normalized = normalizeText(text);

  if (normalized.length === 0) return [];

  // 短いテキストはそのまま1チャンク
  if (normalized.length <= HARD_MAX) {
    return [{ index: 0, text: normalized }];
  }

  // セクション分割
  const sections = splitIntoSections(normalized);

  // 各セクションをチャンクに
  const rawChunks: string[] = [];
  for (const section of sections) {
    if (section.length <= HARD_MAX) {
      rawChunks.push(section);
    } else {
      rawChunks.push(...splitLongSection(section));
    }
  }

  // 短いチャンクを結合
  const merged = mergeShortChunks(rawChunks);

  return merged
    .filter((t) => t.length >= MIN_CHUNK_SIZE)
    .map((text, index) => ({ index, text }));
}

/**
 * テキスト正規化
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

/**
 * セクション分割
 * - 見出し行（■ ▶ ▷、# ## ###）→ 独立セクション
 * - 空行2連続 → セクション区切り
 */
function splitIntoSections(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 見出し検出
    if (/^[■▶▷●★☆◆◇▼▽]/.test(trimmed) || /^#{1,3}\s/.test(trimmed)) {
      if (current.length > 0) {
        sections.push(current.join("\n").trim());
        current = [];
      }
      sections.push(trimmed);
      continue;
    }

    // 空行でセクション区切り
    if (trimmed === "") {
      if (current.length > 0 && current[current.length - 1].trim() === "") {
        // 2連続空行 → セクション区切り
        const sectionText = current.join("\n").trim();
        if (sectionText) sections.push(sectionText);
        current = [];
        continue;
      }
    }

    current.push(line);
  }

  if (current.length > 0) {
    const sectionText = current.join("\n").trim();
    if (sectionText) sections.push(sectionText);
  }

  return sections.filter((s) => s.length > 0);
}

/**
 * 長いセクションをチャンクに分割
 * 分割優先度: \n\n → \n → 。→ 、 → 強制
 */
function splitLongSection(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > HARD_MAX) {
    let splitPoint = -1;

    // 優先度順に分割点を探索
    const delimiters = ["\n\n", "\n", "。", "、"];
    for (const delim of delimiters) {
      // TARGET付近で最適な分割点を探す
      const searchEnd = Math.min(remaining.length, HARD_MAX);
      const lastIndex = remaining.lastIndexOf(delim, searchEnd);

      if (lastIndex >= MIN_CHUNK_SIZE) {
        splitPoint = lastIndex + delim.length;
        break;
      }
    }

    // 分割点が見つからなければ強制分割
    if (splitPoint === -1) {
      splitPoint = TARGET_CHUNK_SIZE;
    }

    chunks.push(remaining.substring(0, splitPoint).trim());
    remaining = remaining.substring(splitPoint).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * 短いチャンクを隣接チャンクと結合
 */
function mergeShortChunks(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;

  const result: string[] = [];
  let buffer = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];

    if (buffer.length + next.length + 1 <= HARD_MAX) {
      buffer = buffer + "\n" + next;
    } else {
      result.push(buffer);
      buffer = next;
    }
  }

  result.push(buffer);
  return result;
}
