import { createClient } from "@supabase/supabase-js";
import { Errors } from "@/lib/utils/errors";

/**
 * Authorizationヘッダーからユーザーを検証（API用）
 */
export async function getUserFromRequest(
  request: Request
): Promise<string> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw Errors.UNAUTHORIZED();
  }

  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw Errors.UNAUTHORIZED();
  }

  return user.id;
}
