import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { getDocument, deleteDocument } from "@/lib/db/documents";
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
    if (!doc) throw Errors.DOCUMENT_NOT_FOUND();
    return Response.json({ data: doc, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getUserFromRequest(request);
    const { id } = await params;
    const doc = await getDocument(id);
    if (!doc) throw Errors.DOCUMENT_NOT_FOUND();

    const supabase = createServerSupabase();
    if (doc.original_file_path) {
      await supabase.storage.from("pdfs").remove([doc.original_file_path]);
    }
    // tts-audio バケットから音声ファイルも削除
    const { data: audioFiles } = await supabase.storage
      .from("tts-audio")
      .list(`tts/${id}`);
    if (audioFiles && audioFiles.length > 0) {
      // フォルダごと削除
      const paths = audioFiles.map((f) => `tts/${id}/${f.name}`);
      await supabase.storage.from("tts-audio").remove(paths);
    }

    await deleteDocument(id);
    return Response.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
