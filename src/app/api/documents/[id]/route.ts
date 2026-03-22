import { NextRequest } from "next/server";
import { getDocument, deleteDocument, getAudioJobsForDocument } from "@/lib/db/documents";
import { createServerSupabase } from "@/lib/db/supabase";
import { handleApiError, Errors } from "@/lib/utils/errors";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doc = await getDocument(id);
    if (!doc) throw Errors.DOCUMENT_NOT_FOUND();
    return Response.json({ data: doc, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doc = await getDocument(id);
    if (!doc) throw Errors.DOCUMENT_NOT_FOUND();

    const supabase = createServerSupabase();
    if (doc.original_file_path) {
      await supabase.storage.from("pdfs").remove([doc.original_file_path]);
    }
    // tts-audio バケットから音声ファイルを削除
    const audioJobs = await getAudioJobsForDocument(id);
    for (const job of audioJobs) {
      const { data: files } = await supabase.storage
        .from("tts-audio")
        .list(`tts/${id}/${job.id}`);
      if (files && files.length > 0) {
        const paths = files.map((f) => `tts/${id}/${job.id}/${f.name}`);
        await supabase.storage.from("tts-audio").remove(paths);
      }
    }

    await deleteDocument(id);
    return Response.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
