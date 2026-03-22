import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { getDocument } from "@/lib/db/documents";
import { createServerSupabase } from "@/lib/db/supabase";
import { handleApiError, Errors } from "@/lib/utils/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getUserFromRequest(request);
    const { id } = await params;
    const doc = await getDocument(id);

    if (!doc) {
      throw Errors.DOCUMENT_NOT_FOUND();
    }

    if (!doc.audio_path) {
      return Response.json(
        {
          data: null,
          error: { code: "NO_AUDIO", message: "音声がまだ生成されていません" },
        },
        { status: 404 }
      );
    }

    // 署名付きURLを生成（1時間有効）
    const supabase = createServerSupabase();
    const { data, error } = await supabase.storage
      .from("audio")
      .createSignedUrl(doc.audio_path, 3600);

    if (error || !data) {
      throw Errors.INTERNAL("Failed to generate audio URL");
    }

    return Response.json({ data: { url: data.signedUrl }, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
