import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Vercelデプロイ時のルートディレクトリ指定
  outputFileTracingRoot: path.join(__dirname),

  // pdf-parseなどNode.jsモジュールのサーバーサイド限定
  serverExternalPackages: ["pdf-parse"],

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
