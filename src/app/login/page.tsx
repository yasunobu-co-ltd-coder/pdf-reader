import { redirect } from "next/navigation";

// ログイン不要 → 文書一覧へリダイレクト
export default function LoginPage() {
  redirect("/documents");
}
