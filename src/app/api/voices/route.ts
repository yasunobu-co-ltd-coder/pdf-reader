import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { getSpeakers } from "@/lib/tts/voicevox-client";
import { handleApiError } from "@/lib/utils/errors";

// 話者一覧は1時間キャッシュ
let cachedSpeakers: Awaited<ReturnType<typeof getSpeakers>> | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1時間

export async function GET(request: NextRequest) {
  try {
    await getUserFromRequest(request);

    if (cachedSpeakers && Date.now() < cacheExpiry) {
      return Response.json({ data: cachedSpeakers, error: null });
    }

    const speakers = await getSpeakers();
    cachedSpeakers = speakers;
    cacheExpiry = Date.now() + CACHE_TTL;

    return Response.json({ data: speakers, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
