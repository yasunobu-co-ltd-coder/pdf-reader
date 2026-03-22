import { splitTextForTts } from "./chunker";
import { generateSpeechForChunk } from "./voicevox-client";
import type { TTSVoiceSetting } from "@/types";

/**
 * WAVバッファ群を1つのWAVに結合する
 * ffmpegを使わず、PCMデータを直接結合する簡易実装（MVP）
 */
function mergeWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("No audio buffers to merge");
  }
  if (buffers.length === 1) return buffers[0];

  // 各WAVからPCMデータ部分を抽出（ヘッダー44バイトをスキップ）
  const pcmChunks: Buffer[] = [];
  let sampleRate = 0;
  let bitsPerSample = 0;
  let numChannels = 0;

  for (const buf of buffers) {
    // WAVヘッダーからパラメータを読み取り（最初のファイルから）
    if (sampleRate === 0) {
      numChannels = buf.readUInt16LE(22);
      sampleRate = buf.readUInt32LE(24);
      bitsPerSample = buf.readUInt16LE(34);
    }

    // dataチャンクの位置を探す
    let dataOffset = 12;
    while (dataOffset < buf.length - 8) {
      const chunkId = buf.toString("ascii", dataOffset, dataOffset + 4);
      const chunkSize = buf.readUInt32LE(dataOffset + 4);
      if (chunkId === "data") {
        pcmChunks.push(buf.subarray(dataOffset + 8, dataOffset + 8 + chunkSize));
        break;
      }
      dataOffset += 8 + chunkSize;
    }

    // チャンク間に短い無音を挿入（200ms）
    const silenceSamples = Math.floor(sampleRate * 0.2);
    const silenceBytes = silenceSamples * numChannels * (bitsPerSample / 8);
    pcmChunks.push(Buffer.alloc(silenceBytes, 0));
  }

  // PCMデータを結合
  const totalPcmData = Buffer.concat(pcmChunks);
  const totalDataSize = totalPcmData.length;

  // 新しいWAVヘッダーを作成
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + totalDataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(totalDataSize, 40);

  return Buffer.concat([header, totalPcmData]);
}

/**
 * WAVの再生時間を計算（秒）
 */
function calculateWavDuration(wavBuffer: Buffer): number {
  const sampleRate = wavBuffer.readUInt32LE(24);
  const bitsPerSample = wavBuffer.readUInt16LE(34);
  const numChannels = wavBuffer.readUInt16LE(22);
  // dataチャンクを探す
  let dataOffset = 12;
  while (dataOffset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = wavBuffer.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") {
      return chunkSize / (sampleRate * numChannels * (bitsPerSample / 8));
    }
    dataOffset += 8 + chunkSize;
  }
  return 0;
}

export interface GenerateResult {
  audioBuffer: Buffer;
  durationSec: number;
  chunkCount: number;
}

/**
 * ttsTextから音声を生成する（メインパイプライン）
 */
export async function generateVoiceForDocument(
  ttsText: string,
  voiceSetting: TTSVoiceSetting,
  onProgress?: (completed: number, total: number) => void
): Promise<GenerateResult> {
  // 1. チャンク分割
  const chunks = splitTextForTts(ttsText);

  if (chunks.length === 0) {
    throw new Error("No text chunks to generate audio for");
  }

  // 2. チャンクごとに音声生成（逐次処理、VOICEVOX負荷考慮）
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    let lastError: Error | null = null;
    let success = false;

    // リトライ（最大3回）
    for (let retry = 0; retry < 3; retry++) {
      try {
        const buffer = await generateSpeechForChunk(
          chunk.text,
          voiceSetting.speaker_id,
          {
            speedScale: voiceSetting.speed_scale,
            pitchScale: voiceSetting.pitch_scale,
            intonationScale: voiceSetting.intonation_scale,
            volumeScale: voiceSetting.volume_scale,
          }
        );
        audioBuffers.push(buffer);
        success = true;
        break;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `Chunk ${i} generation failed (attempt ${retry + 1}/3):`,
          lastError.message
        );
        // リトライ前に少し待つ
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!success) {
      console.error(
        `Chunk ${i} failed after 3 retries: "${chunk.text.substring(0, 50)}..."`
      );
      // 失敗したチャンクはスキップして続行
    }

    onProgress?.(i + 1, chunks.length);
  }

  if (audioBuffers.length === 0) {
    throw new Error("All chunks failed to generate");
  }

  // 3. WAV結合
  const mergedBuffer = mergeWavBuffers(audioBuffers);
  const durationSec = calculateWavDuration(mergedBuffer);

  return {
    audioBuffer: mergedBuffer,
    durationSec,
    chunkCount: chunks.length,
  };
}
