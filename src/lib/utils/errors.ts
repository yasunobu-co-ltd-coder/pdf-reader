export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public retryable: boolean,
    public userMessage: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  PDF_CORRUPTED: () =>
    new AppError(
      "PDF file is corrupted",
      "PDF_CORRUPTED",
      400,
      false,
      "PDFファイルが破損しています。別のファイルをお試しください"
    ),
  PDF_NO_TEXT: () =>
    new AppError(
      "PDF contains no extractable text",
      "PDF_NO_TEXT",
      400,
      false,
      "このPDFからテキストを抽出できませんでした。テキストPDFのみ対応しています"
    ),
  PDF_PARSE_FAILED: () =>
    new AppError(
      "PDF parsing failed (possibly too large or complex)",
      "PDF_PARSE_FAILED",
      422,
      true,
      "PDFの解析に失敗しました。ファイルが大きすぎるか複雑すぎる可能性があります。リトライしてください"
    ),
  PDF_TOO_LARGE: () =>
    new AppError(
      "PDF file is too large",
      "PDF_TOO_LARGE",
      413,
      false,
      "ファイルサイズが上限を超えています"
    ),
  VOICEVOX_UNAVAILABLE: () =>
    new AppError(
      "VOICEVOX engine is unavailable",
      "VOICEVOX_UNAVAILABLE",
      503,
      true,
      "音声生成サーバーに接続できません。しばらく待ってリトライしてください"
    ),
  VOICEVOX_GENERATION_FAILED: () =>
    new AppError(
      "VOICEVOX audio generation failed",
      "VOICEVOX_GENERATION_FAILED",
      500,
      true,
      "音声生成に失敗しました。リトライしてください"
    ),
  DOCUMENT_NOT_FOUND: () =>
    new AppError(
      "Document not found",
      "DOCUMENT_NOT_FOUND",
      404,
      false,
      "文書が見つかりません"
    ),
  UNAUTHORIZED: () =>
    new AppError(
      "Unauthorized",
      "UNAUTHORIZED",
      401,
      false,
      "ログインが必要です"
    ),
  INTERNAL: (detail?: string) =>
    new AppError(
      detail || "Internal server error",
      "INTERNAL_ERROR",
      500,
      false,
      "予期しないエラーが発生しました"
    ),
};

export function handleApiError(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        data: null,
        error: {
          code: error.code,
          message: error.userMessage,
          retryable: error.retryable,
        },
      },
      { status: error.statusCode }
    );
  }

  console.error("Unexpected error:", error);
  const e = Errors.INTERNAL();
  return Response.json(
    {
      data: null,
      error: { code: e.code, message: e.userMessage, retryable: false },
    },
    { status: 500 }
  );
}
