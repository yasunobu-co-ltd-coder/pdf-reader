import { createClient, SupabaseClient } from "@supabase/supabase-js";

// サーバーサイド用（Service Role Key）
export function createServerSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server config missing");
  }
  return createClient(url, key);
}

// クライアントサイド用（Anon Key）- シングルトン、遅延初期化
let browserClient: SupabaseClient | null = null;

export function createBrowserSupabase(): SupabaseClient {
  if (browserClient) return browserClient;

  // ビルド時・SSR時は環境変数が未設定の場合がある
  // ダミーURLで作成し、実行時にエラーになる（クライアントサイドでは正常）
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";

  browserClient = createClient(url, key);
  return browserClient;
}
