import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { handleApiError } from "@/lib/utils/errors";
import { VOICE_CHARACTERS } from "@/types";

export async function GET(request: NextRequest) {
  try {
    await getUserFromRequest(request);

    // キャラクター定義から話者一覧を返す
    const voices = VOICE_CHARACTERS.map((vc) => ({
      name: vc.name,
      styles: [{ name: vc.description, id: vc.speaker_id }],
    }));

    return Response.json({ data: voices, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
