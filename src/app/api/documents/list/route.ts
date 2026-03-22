import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { getDocumentsByUser } from "@/lib/db/documents";
import { handleApiError } from "@/lib/utils/errors";

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    const documents = await getDocumentsByUser(userId);

    // テキスト本文はリスト表示では不要なので除外
    const list = documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      status: doc.status,
      total_pages: doc.total_pages,
      duration_sec: doc.duration_sec,
      error_message: doc.error_message,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    }));

    return Response.json({ data: list, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
