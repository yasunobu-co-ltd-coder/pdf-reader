/**
 * ttsTextをVOICEVOX投入用チャンクに分割する
 *
 * 分割優先順位:
 * 1. 空行（段落区切り）
 * 2. 句点「。」
 * 3. 感嘆符・疑問符
 * 4. 読点「、」（maxChars超過時のみ）
 * 5. 強制分割（最終手段）
 */

const CHUNK_CONFIG = {
  maxCharsPerChunk: 200,
  minCharsPerChunk: 5,
} as const;

export interface TextChunk {
  index: number;
  text: string;
}

export function splitTextForTts(ttsText: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  // 空行で段落分割
  const paragraphs = ttsText.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;

    // 改行を除去して1行に
    const line = trimmed.replace(/\n/g, "");

    if (line.length <= CHUNK_CONFIG.maxCharsPerChunk) {
      chunks.push({ index: chunkIndex++, text: line });
    } else {
      // 文単位で分割
      const sentences = splitBySentence(line);
      let buffer = "";

      for (const sentence of sentences) {
        if (
          buffer.length + sentence.length >
          CHUNK_CONFIG.maxCharsPerChunk &&
          buffer.length >= CHUNK_CONFIG.minCharsPerChunk
        ) {
          chunks.push({ index: chunkIndex++, text: buffer.trim() });
          buffer = "";
        }
        buffer += sentence;
      }

      if (buffer.trim().length >= CHUNK_CONFIG.minCharsPerChunk) {
        chunks.push({ index: chunkIndex++, text: buffer.trim() });
      }
    }
  }

  // 空チャンクが出た場合に備えてフィルタ
  return chunks.filter((c) => c.text.length >= CHUNK_CONFIG.minCharsPerChunk);
}

/**
 * 句点・感嘆符・疑問符で文を分割（区切り文字を保持）
 */
function splitBySentence(text: string): string[] {
  const parts = text.split(/(。|！|？|！|？|\!|\?)/);
  const sentences: string[] = [];

  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] + (parts[i + 1] || "");
    if (sentence.trim().length > 0) {
      // まだ長すぎる場合は読点で分割
      if (sentence.length > CHUNK_CONFIG.maxCharsPerChunk) {
        const subParts = sentence.split(/(、)/);
        let sub = "";
        for (let j = 0; j < subParts.length; j += 2) {
          const piece = subParts[j] + (subParts[j + 1] || "");
          if (
            sub.length + piece.length > CHUNK_CONFIG.maxCharsPerChunk &&
            sub.length > 0
          ) {
            sentences.push(sub);
            sub = "";
          }
          sub += piece;
        }
        if (sub.length > 0) sentences.push(sub);
      } else {
        sentences.push(sentence);
      }
    }
  }

  return sentences;
}
