/**
 * rawTextをVOICEVOX向けttsTextに変換するルールベース処理
 * MVP版: LLMは使わず、正規表現ベースで整形
 */

// 記号→読み方マッピング
const SYMBOL_MAP: Record<string, string> = {
  "※": "、",
  "→": "、",
  "←": "、",
  "↑": "、",
  "↓": "、",
  "＆": "アンド",
  "&": "アンド",
  "＋": "プラス",
  "＝": "イコール",
};

// 単位→読み方マッピング
const UNIT_MAP: [RegExp, string][] = [
  [/(\d+(?:\.\d+)?)\s*%/g, "$1パーセント"],
  [/(\d+(?:\.\d+)?)\s*％/g, "$1パーセント"],
  [/(\d+(?:\.\d+)?)\s*kg/gi, "$1キログラム"],
  [/(\d+(?:\.\d+)?)\s*km/gi, "$1キロメートル"],
  [/(\d+(?:\.\d+)?)\s*cm/g, "$1センチメートル"],
  [/(\d+(?:\.\d+)?)\s*mm/g, "$1ミリメートル"],
  [/(\d+(?:\.\d+)?)\s*GB/g, "$1ギガバイト"],
  [/(\d+(?:\.\d+)?)\s*MB/g, "$1メガバイト"],
];

// 英字略語→読み方マッピング
const ABBREVIATION_MAP: Record<string, string> = {
  PDF: "ピーディーエフ",
  AI: "エーアイ",
  API: "エーピーアイ",
  URL: "ユーアールエル",
  IT: "アイティー",
  DX: "ディーエックス",
  SNS: "エスエヌエス",
  PC: "ピーシー",
  OS: "オーエス",
  CEO: "シーイーオー",
  CTO: "シーティーオー",
  KPI: "ケーピーアイ",
};

export function convertRawTextToTtsText(rawText: string): string {
  let text = rawText;

  // 1. URL除去
  text = text.replace(/https?:\/\/[^\s]+/g, "、ユーアールエル省略、");

  // 2. メールアドレス除去
  text = text.replace(/[\w.+-]+@[\w.-]+\.\w+/g, "、メールアドレス省略、");

  // 3. ページ番号パターン除去（行頭・行末の数字のみの行）
  text = text.replace(/^\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*$/gm, "");

  // 4. 金額表記
  text = text.replace(/[¥￥]\s?([0-9,]+)/g, (_, amount) => {
    return amount.replace(/,/g, "") + "円";
  });

  // 5. 桁区切りカンマ除去
  text = text.replace(/(\d),(\d{3})/g, "$1$2");

  // 6. 単位変換
  for (const [regex, replacement] of UNIT_MAP) {
    text = text.replace(regex, replacement);
  }

  // 7. 英字略語変換（大文字のみ、単語境界）
  for (const [abbr, reading] of Object.entries(ABBREVIATION_MAP)) {
    const regex = new RegExp(`(?<![A-Za-z])${abbr}(?![A-Za-z])`, "g");
    text = text.replace(regex, reading);
  }

  // 8. 記号変換
  for (const [symbol, reading] of Object.entries(SYMBOL_MAP)) {
    text = text.replaceAll(symbol, reading);
  }

  // 9. 括弧内の注釈除去
  text = text.replace(/[（(]注\d+[）)]/g, "");
  text = text.replace(/[（(](?:図|表|グラフ)\d+(?:参照)?[）)]/g, "");

  // 10. 残った括弧を読点に
  text = text.replace(/[（(]/g, "、");
  text = text.replace(/[）)]/g, "、");

  // 11. 全角スペースを半角に
  text = text.replace(/\u3000/g, " ");

  // 12. 連続スペースを1つに
  text = text.replace(/ {2,}/g, " ");

  // 13. 制御文字除去
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 14. 日本語文中の不要改行を除去
  text = text.replace(
    /([\u3040-\u9FFF\u30A0-\u30FF])[\r\n]+([\u3040-\u9FFF\u30A0-\u30FF])/g,
    "$1$2"
  );

  // 15. 3つ以上の連続改行を2つに
  text = text.replace(/\n{3,}/g, "\n\n");

  // 16. 連続読点の整理
  text = text.replace(/、{2,}/g, "、");

  // 17. 文頭・文末の読点除去
  text = text.replace(/^、+/gm, "");
  text = text.replace(/、+$/gm, "");

  // 18. 行頭・行末の余分スペース除去
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return text.trim();
}
