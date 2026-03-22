import type { NextConfig } from "next";
import path from "path";
import { execSync } from "child_process";

// ビルド時にコミットハッシュを取得
let commitHash = "unknown";
try {
  commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  // Vercel では VERCEL_GIT_COMMIT_SHA が使える
  commitHash = (process.env.VERCEL_GIT_COMMIT_SHA || "unknown").slice(0, 7);
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: commitHash,
  },
  // Vercelデプロイ時のルートディレクトリ指定
  outputFileTracingRoot: path.join(__dirname),

  // pdf-parseなどNode.jsモジュールのサーバーサイド限定
  serverExternalPackages: ["pdf-parse", "tesseract.js"],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // クライアントバンドルからNode.jsモジュールを除外
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },

  // API Route のタイムアウト延長（Vercel Pro以上で有効）
  // 音声生成に時間がかかるため
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
