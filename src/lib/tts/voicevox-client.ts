import { VoicevoxAudioQuery, VoicevoxSpeaker } from "@/types";
import { Errors } from "@/lib/utils/errors";

interface VoicevoxConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

function getConfig(): VoicevoxConfig {
  return {
    baseUrl: process.env.VOICEVOX_BASE_URL || "http://localhost:50021",
    username: process.env.VOICEVOX_USERNAME || "",
    password: process.env.VOICEVOX_PASSWORD || "",
    timeoutMs: parseInt(process.env.VOICEVOX_TIMEOUT_MS || "120000"),
  };
}

function getAuthHeader(config: VoicevoxConfig): Record<string, string> {
  if (!config.username) return {};
  const encoded = Buffer.from(
    `${config.username}:${config.password}`
  ).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

/**
 * テキストからAudioQueryを生成
 */
export async function createAudioQuery(
  text: string,
  speakerId: number
): Promise<VoicevoxAudioQuery> {
  const config = getConfig();
  const url = new URL("/audio_query", config.baseUrl);
  url.searchParams.set("text", text);
  url.searchParams.set("speaker", speakerId.toString());

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: getAuthHeader(config),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    console.error(
      `VOICEVOX audio_query failed: ${response.status} ${response.statusText}`
    );
    throw Errors.VOICEVOX_UNAVAILABLE();
  }

  return response.json();
}

/**
 * AudioQueryから音声WAVを合成
 */
export async function synthesizeVoice(
  audioQuery: VoicevoxAudioQuery,
  speakerId: number
): Promise<Buffer> {
  const config = getConfig();
  const url = new URL("/synthesis", config.baseUrl);
  url.searchParams.set("speaker", speakerId.toString());

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...getAuthHeader(config),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(audioQuery),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    console.error(
      `VOICEVOX synthesis failed: ${response.status} ${response.statusText}`
    );
    throw Errors.VOICEVOX_GENERATION_FAILED();
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * テキストから直接音声を生成
 */
export async function generateSpeechForChunk(
  text: string,
  speakerId: number,
  voiceParams?: {
    speedScale?: number;
    pitchScale?: number;
    intonationScale?: number;
    volumeScale?: number;
  }
): Promise<Buffer> {
  const query = await createAudioQuery(text, speakerId);

  // ユーザー設定を適用
  if (voiceParams) {
    if (voiceParams.speedScale !== undefined)
      query.speedScale = voiceParams.speedScale;
    if (voiceParams.pitchScale !== undefined)
      query.pitchScale = voiceParams.pitchScale;
    if (voiceParams.intonationScale !== undefined)
      query.intonationScale = voiceParams.intonationScale;
    if (voiceParams.volumeScale !== undefined)
      query.volumeScale = voiceParams.volumeScale;
  }

  return synthesizeVoice(query, speakerId);
}

/**
 * 利用可能な話者一覧を取得
 */
export async function getSpeakers(): Promise<VoicevoxSpeaker[]> {
  const config = getConfig();
  const url = new URL("/speakers", config.baseUrl);

  const response = await fetch(url.toString(), {
    headers: getAuthHeader(config),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw Errors.VOICEVOX_UNAVAILABLE();
  }

  return response.json();
}

/**
 * ヘルスチェック
 */
export async function checkVoicevoxHealth(): Promise<boolean> {
  try {
    const speakers = await getSpeakers();
    return speakers.length > 0;
  } catch {
    return false;
  }
}
