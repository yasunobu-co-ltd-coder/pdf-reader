import { NextRequest } from "next/server";
import { ANONYMOUS_USER_ID } from "@/lib/db/auth";
import {
  getDefaultVoiceSetting,
  upsertVoiceSetting,
} from "@/lib/db/documents";
import { handleApiError } from "@/lib/utils/errors";

export async function GET() {
  try {
    const setting = await getDefaultVoiceSetting(ANONYMOUS_USER_ID);
    return Response.json({ data: setting, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const setting = await upsertVoiceSetting(ANONYMOUS_USER_ID, {
      speaker_id: body.speaker_id,
      speed_scale: body.speed_scale,
      pitch_scale: body.pitch_scale,
      intonation_scale: body.intonation_scale,
      volume_scale: body.volume_scale,
    });

    return Response.json({ data: setting, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
