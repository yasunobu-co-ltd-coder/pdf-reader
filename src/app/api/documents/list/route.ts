import { getAllDocuments } from "@/lib/db/documents";
import { handleApiError } from "@/lib/utils/errors";

export async function GET() {
  try {
    const documents = await getAllDocuments();

    // テキスト本文はリスト表示では不要なので除外
    const list = documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      status: doc.status,
      total_pages: doc.total_pages,
      error_message: doc.error_message,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    }));

    return Response.json({ data: list, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
