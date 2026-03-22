/**
 * Next.js Instrumentation - サーバー起動時に最初に実行される
 * pdfjs-dist が要求するブラウザAPIのポリフィルをここで確実に読み込む
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // @ts-expect-error side-effect only import, no exports
    await import("./lib/pdf/node-polyfill");
  }
}
