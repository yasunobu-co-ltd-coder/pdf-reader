import { handleApiError } from "@/lib/utils/errors";
import { VOICE_CHARACTERS } from "@/types";

export async function GET() {
  try {
    const voices = VOICE_CHARACTERS.map((vc) => ({
      name: vc.name,
      styles: [{ name: vc.description, id: vc.speaker_id }],
    }));

    return Response.json({ data: voices, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
