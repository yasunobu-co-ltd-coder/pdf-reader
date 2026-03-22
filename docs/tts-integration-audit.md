# TTS統合 監査レポート

新アプリ側のTTS音声生成機能の現状診断・問題点・修正プランをまとめたレポート。

---

## 1. 現状診断

### A. 環境変数の扱い

| 項目 | 結果 | 根拠 |
|------|------|------|
| `VOICEVOX_API_URL` を src/ 内で参照していないか | **OK** | grep結果: src/ 内に `VOICEVOX_API_URL` の参照なし。Worker の `.env` 専用 |
| `service_role key` がクライアントに露出していないか | **OK** | `SUPABASE_SERVICE_ROLE_KEY` は `src/lib/db/supabase.ts:6` の `createServerSupabase()` のみで使用。クライアントコンポーネントからは `createBrowserSupabase()` (anon key) を使用 |
| Vercel 向け env と server-only env の分離 | **OK** | `NEXT_PUBLIC_*` はクライアント用、`SUPABASE_SERVICE_ROLE_KEY` はサーバー専用。適切に分離済み |
| `.env.local.example` に不要な変数がないか | **注意** | `VOICEVOX_API_URL` と `VOICEVOX_TIMEOUT_MS` が `.env.local.example` に残っているが、Vercel/Next.js 側では使用されていない。混乱の元になるが実害なし |

### B. TTS生成API (`/api/tts/generate`)

| 項目 | 結果 |
|------|------|
| ルート存在 | **OK** — `src/app/api/tts/generate/route.ts` |
| `document_audio` 作成 | **OK** — `createAudioJob()` でレコード作成 |
| `document_audio_chunks` 作成 | **OK** — `insertChunkRecords()` でチャンクレコード一括挿入 |
| `document_id` 受け取り | **OK** — `body.document_id` |
| `speaker_id` 受け取り | **OK** — `body.speaker_id` (省略時 `DEFAULT_SPEAKER_ID=3`) |
| バリデーション | **OK** — document_id必須チェック、文書存在チェック、tts_text空チェック、チャンク0件チェック |
| 重複作成防止 | **OK** — `getLatestAudioForSpeaker()` で既存ジョブ確認、text_hash一致 & 非failedならスキップ |
| 差分生成 | **OK** — `createDiffJob()` で旧チャンクの audio_url をコピー |
| キュー混雑制御 | **OK** — `QUEUE_THRESHOLD=4` で混雑時は選択キャラのみ |

### C. TTS進捗取得API (`/api/tts/status`)

| 項目 | 結果 |
|------|------|
| ルート存在 | **OK** — `src/app/api/tts/status/route.ts` |
| `document_audio` 参照 | **OK** — `getLatestAudioForSpeaker()` |
| `document_audio_chunks` 参照 | **OK** — `getChunksForAudio()` で audio_url 付きチャンク返却 |
| ステータス分岐 | **OK** — `not_generated` / `generating` / `processing` / `ready` / `failed` |
| Early Playback 対応 | **OK** — 各チャンクの `audio_url` を個別に返すため、揃ったチャンクから再生可能 |

### D. フロント側UI

| 項目 | 結果 |
|------|------|
| 音声生成ボタン | **OK** — `handleGenerate()` で `/api/tts/generate` を呼出 |
| キャラクター選択UI | **OK** — `VOICE_CHARACTERS` 4種から選択可能 |
| プログレスバー | **OK** — `completed_chunks / total_chunks` でプログレスバー表示 |
| ステータスポーリング | **OK** — `generating`/`processing` 中は2秒間隔でポーリング |
| Early Playback | **OK** — `playableChunks = chunks.filter(c => c.audio_url)` で揃ったチャンクから再生 |
| シークバー | **OK** — グローバルタイムラインのシーク実装済み |
| チャンクリスト | **OK** — チャンク一覧からクリックで再生ジャンプ可能 |
| failed 時の再生成 | **OK** — `isFailed` 時に「再生成する」ボタン表示 |
| 再生自動連続 | **OK** — `handleChunkEnded()` で次チャンクへ自動遷移 |
| プリロード | **OK** — 再生中に次チャンクを `new Audio()` でプリロード |

### E. Supabase周りの整合性

| 項目 | 結果 | 詳細 |
|------|------|------|
| `document_audio` テーブル参照 | **OK** | DB関数・API Route で適切に参照 |
| `document_audio_chunks` テーブル参照 | **OK** | 挿入・取得ともに実装済み |
| Storage バケット名 `tts-audio` | **OK** | Worker・フロント・DELETE処理すべて `tts-audio` で統一 |
| `audio_url` の扱い | **OK** | Worker が Storage パス (`tts/{docId}/{audioId}/chunk_{i}.wav`) を保存、フロントが `${SUPABASE_URL}/storage/v1/object/public/tts-audio/${path}` で再生 |
| schema と型定義の整合性 | **OK** | `src/types/index.ts` の型定義が `schema.sql` と一致 |

### F. 旧構成の残骸確認

| 項目 | 結果 | 詳細 |
|------|------|------|
| VOICEVOX API 直接呼び出し | **OK (削除済み)** | `src/lib/tts/voicevox-client.ts` と `src/lib/tts/generator.ts` は既に削除されている。`chunk-splitter.ts` のみ残存（これは正しい） |
| フロントから VPS IP 直接参照 | **OK** | src/ 内に `49.212.138.170` や `50021` の参照なし |
| 旧テーブル名 (`audio_path` 等) | **OK** | 旧構成の残骸なし |
| 旧 Storage パス | **OK** | `tts-audio` + `tts/` prefix に統一済み |

---

## 2. 問題点一覧

### 問題 1: Storage バケット公開設定の不一致

- **深刻度**: 致命
- **現状**: `schema.sql` L187 のコメントに `tts-audio (private)` と記載。フロントは `storage/v1/object/public/tts-audio/` で Public URL として参照している
- **本来**: tts-audio バケットは **Public** に設定すべき（コメントも `public` にすべき）
- **影響範囲**: 音声が再生できない（403エラー）
- **修正方針**: Supabase Dashboard で tts-audio を Public に変更。schema.sql のコメントも修正
- **修正対象**: `supabase/schema.sql` (コメント修正)、Supabase Dashboard (バケット設定)

### 問題 2: DELETE処理のStorage再帰削除が不完全

- **深刻度**: 中
- **現状**: `api/documents/[id]/route.ts` L39 で `supabase.storage.from("tts-audio").list(\`tts/${id}\`)` としているが、Supabase Storage の `list()` はフラットリストのみ返す。実際のパスは `tts/{docId}/{audioId}/chunk_{i}.wav` と2階層あるため、1階層目のリスト結果は `audioId` フォルダ名のみになり、`remove()` に渡してもファイル削除されない
- **本来**: `document_audio` テーブルから `audioId` を取得し、各 `audioId` 配下のファイルを個別リスト → 削除
- **影響範囲**: 文書削除時に孤立した音声ファイルが Storage に残る
- **修正方針**: DELETE処理で `getAudioJobsForDocument()` を使い、各 audioId フォルダを個別に削除
- **修正対象**: `src/app/api/documents/[id]/route.ts`

### 問題 3: `.env.local.example` に不要なVOICEVOX変数

- **深刻度**: 低
- **現状**: `VOICEVOX_API_URL` と `VOICEVOX_TIMEOUT_MS` が `.env.local.example` に含まれている。Next.js 側のコードではこれらを参照していない
- **本来**: Vercel/Next.js 側に VOICEVOX 関連変数は不要
- **影響範囲**: 開発者の混乱（「Vercel にも VOICEVOX の設定が要るのか？」）
- **修正方針**: `.env.local.example` から VOICEVOX 変数を削除するか、コメントで「Worker専用」と明記
- **修正対象**: `.env.local.example`

### 問題 4: auth.ts で anon key + getUser で認証

- **深刻度**: 低（機能的には問題なし）
- **現状**: `src/lib/db/auth.ts` で `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `getUser(token)` を使用。これ自体は正常動作する（Supabase が JWT を検証）
- **本来**: セキュリティ上の問題はない。`getUser()` は JWT をサーバー側で検証するため安全
- **影響範囲**: なし
- **修正方針**: 現状維持で問題なし

### 問題 5: RLS ポリシーで document_audio の INSERT がない

- **深刻度**: 致命（条件付き）
- **現状**: `schema.sql` の RLS ポリシーで `document_audio` は SELECT のみ定義。INSERT/UPDATE ポリシーがない。コメントで「Worker は service_role key で操作するため INSERT/UPDATE は RLS 不要」と記載
- **本来**: API Route（`/api/tts/generate`）も `createServerSupabase()` (service_role key) を使用しているため、RLS バイパスされる。**現状の実装では問題ない**
- **ただし**: DB関数 `documents.ts` 内で `createServerSupabase()` を呼んでいるため、API Route の認証は `getUserFromRequest()` で行い、DB操作は service_role で行う二段構え。これは意図的な設計
- **影響範囲**: なし（service_role key 使用のため）
- **修正方針**: 現状維持

### 問題 6: Worker の VOICEVOX fetch に空ヘッダーオブジェクト

- **深刻度**: 低
- **現状**: `tts-worker.js` L56-57 の `audioQuery()` で `headers: {}` を渡している（旧 Basic認証削除の際の残骸）
- **本来**: `headers` プロパティ自体を省略するか、空オブジェクトでも動作に支障なし
- **影響範囲**: なし（空ヘッダーでも fetch は正常動作）
- **修正方針**: 気になるなら `headers` 行を削除
- **修正対象**: `vps-tts-worker/tts-worker.js`

---

## 3. 最短修正プラン

### フェーズ1: まず動かすための最小修正

実装は **ほぼ完成** している。以下のみ確認・修正すれば動作する。

#### 1-1. Supabase の tts-audio バケットを Public に設定
Supabase Dashboard → Storage → tts-audio → Settings → Public access を ON にする。

#### 1-2. Supabase に schema.sql を適用
Supabase Dashboard → SQL Editor で `schema.sql` を実行。
既にテーブルが存在する場合は `CREATE TABLE IF NOT EXISTS` に変更するか、既存テーブルの確認が必要。

#### 1-3. Supabase Storage に pdfs / tts-audio バケットを作成
Dashboard → Storage で2つのバケットを手動作成。

#### 1-4. Vercel に環境変数を設定
```
NEXT_PUBLIC_SUPABASE_URL=https://lswmpnrqhjcbicvhexla.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

#### 1-5. VPS Worker の .env を設定して起動
```
SUPABASE_URL=https://lswmpnrqhjcbicvhexla.supabase.co
SUPABASE_SERVICE_ROLE_KEY=（service_role key）
VOICEVOX_API_URL=http://49.212.138.170:50021
```

```bash
cd ~/pdf-reader/vps-tts-worker
npm install
node tts-worker.js
```

### フェーズ2: 実運用に耐える修正

| 修正 | 対象ファイル | 内容 |
|------|------------|------|
| DELETE の Storage 削除修正 | `api/documents/[id]/route.ts` | 2階層の再帰削除対応 |
| `.env.local.example` 整理 | `.env.local.example` | VOICEVOX 変数にコメント追記 |
| schema.sql コメント修正 | `supabase/schema.sql` | `private` → `public` |
| Worker systemd 化 | VPS | systemd サービス登録 |

### フェーズ3: UX 改善

現在の実装で既に以下が実装済み:
- Early Playback
- チャンク単位のプログレス表示
- シークバー
- failed 時の再生成ボタン
- キャラクター選択

追加で実装可能な改善:
- 速度調整（VOICEVOX の speedScale パラメータを Worker に渡す）
- ポーリング最適化（Visibility API で非表示タブ時にポーリング停止）
- 再生位置記憶（localStorage）
- キャラクター別の再生済み/未生成バッジ

---

## 4. 実装コード（必要な修正）

### 修正A: DELETE の Storage 再帰削除を修正

```typescript
// src/app/api/documents/[id]/route.ts（既存修正）
// 用途: 文書削除時に tts-audio の音声ファイルを正しく全削除する

import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/db/auth";
import { getDocument, deleteDocument, getAudioJobsForDocument } from "@/lib/db/documents";
import { createServerSupabase } from "@/lib/db/supabase";
import { handleApiError, Errors } from "@/lib/utils/errors";

// ... GET は変更なし ...

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getUserFromRequest(request);
    const { id } = await params;
    const doc = await getDocument(id);
    if (!doc) throw Errors.DOCUMENT_NOT_FOUND();

    const supabase = createServerSupabase();

    // PDF原本削除
    if (doc.original_file_path) {
      await supabase.storage.from("pdfs").remove([doc.original_file_path]);
    }

    // tts-audio: 各 audioId フォルダ配下のファイルを削除
    const audioJobs = await getAudioJobsForDocument(id);
    for (const job of audioJobs) {
      const { data: files } = await supabase.storage
        .from("tts-audio")
        .list(`tts/${id}/${job.id}`);
      if (files && files.length > 0) {
        const paths = files.map((f) => `tts/${id}/${job.id}/${f.name}`);
        await supabase.storage.from("tts-audio").remove(paths);
      }
    }

    await deleteDocument(id);
    return Response.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
```

### 修正B: schema.sql コメント修正

```sql
-- tts-audio (public) - 生成音声WAV（フロントから直接再生するため Public）
```

### 修正C: .env.local.example の整理

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://lswmpnrqhjcbicvhexla.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App
MAX_PDF_SIZE_MB=100
MAX_PDF_PAGES=500

# ※ VOICEVOX 関連 (VOICEVOX_API_URL 等) は Vercel 側では不要
# ※ VPS Worker 側の .env (vps-tts-worker/.env) で設定してください
```

---

## 5. 実装後の動作確認チェックリスト

### env 設定確認
- [ ] Vercel に `NEXT_PUBLIC_SUPABASE_URL` が設定されている
- [ ] Vercel に `NEXT_PUBLIC_SUPABASE_ANON_KEY` が設定されている
- [ ] Vercel に `SUPABASE_SERVICE_ROLE_KEY` が設定されている
- [ ] VPS Worker に `SUPABASE_URL` が設定されている
- [ ] VPS Worker に `SUPABASE_SERVICE_ROLE_KEY` が設定されている
- [ ] VPS Worker に `VOICEVOX_API_URL` が設定されている

### Supabase 設定確認
- [ ] `documents` テーブルが存在する
- [ ] `document_audio` テーブルが存在する
- [ ] `document_audio_chunks` テーブルが存在する
- [ ] `tts_voice_settings` テーブルが存在する
- [ ] `pdfs` バケットが存在する (Private)
- [ ] `tts-audio` バケットが存在する (**Public**)
- [ ] RLS ポリシーが適用されている

### 機能確認
- [ ] ブラウザでログインできる
- [ ] PDFをアップロードできる → documents レコードが status=extracted で作成される
- [ ] 文書詳細画面でキャラクター選択UIが表示される
- [ ] 「音声を生成する」ボタンを押せる
- [ ] `/api/tts/generate` が200を返す
- [ ] `document_audio` レコードが status=generating で作成される
- [ ] `document_audio_chunks` レコードがチャンク数分作成される
- [ ] VPS Worker のログに `[START] Job ...` が表示される
- [ ] Worker が VOICEVOX に接続でき、チャンクが処理される
- [ ] `tts-audio` バケットに WAV ファイルがアップロードされる
- [ ] チャンクレコードに `audio_url` が書き込まれる
- [ ] フロントのプログレスバーが進行する
- [ ] Early Playback で途中のチャンクから再生できる
- [ ] `document_audio` が status=ready になる
- [ ] シークバーで任意位置にジャンプできる
- [ ] 全チャンクが連続再生される

---

## 6. デバッグ手順

「音声生成ボタンを押しても動かない」場合の切り分け手順。

### Step 1: フロント確認
```
ブラウザ DevTools → Console タブ
- エラーメッセージが表示されていないか
- Network タブで /api/tts/generate のリクエストを確認
  - リクエストが送信されているか
  - ステータスコードは何か
  - レスポンスボディの内容は何か
  - Authorization ヘッダーが付いているか
```

### Step 2: API Route 確認
```
/api/tts/generate のレスポンスを確認:
- 401: ログインセッションが切れている → 再ログイン
- 400 (BAD_REQUEST): document_id が送信されていない
- 400 (NO_TEXT): PDFのテキスト抽出が失敗している → documents.tts_text を確認
- 400 (NO_CHUNKS): テキストが短すぎてチャンク分割できなかった
- 404 (DOCUMENT_NOT_FOUND): document_id が不正
- 500: サーバーエラー → Vercel のログを確認
```

### Step 3: Supabase DB 確認
```sql
-- document_audio にジョブが作成されているか
SELECT id, status, speaker_id, total_chunks, completed_chunks,
       locked_by, processing_started_at, error_message
FROM document_audio
WHERE document_id = '対象のdocument_id'
ORDER BY created_at DESC
LIMIT 5;

-- チャンクが作成されているか
SELECT chunk_index, chunk_text, audio_url, duration_sec
FROM document_audio_chunks
WHERE audio_id = '上で確認したaudio_id'
ORDER BY chunk_index
LIMIT 10;
```

確認ポイント:
- `status=generating, locked_by=NULL` → Worker がまだ拾っていない
- `status=processing, locked_by=xxx` → Worker が処理中
- `status=failed` → `error_message` を確認
- チャンクが0件 → `insertChunkRecords()` が失敗している

### Step 4: Supabase Storage 確認
```
Supabase Dashboard → Storage → tts-audio
- tts/{documentId}/{audioId}/ フォルダが存在するか
- chunk_0.wav 等のファイルが存在するか
- ファイルサイズが 0 でないか
- バケットが Public に設定されているか確認

ブラウザで直接アクセスしてみる:
https://lswmpnrqhjcbicvhexla.supabase.co/storage/v1/object/public/tts-audio/tts/{docId}/{audioId}/chunk_0.wav
→ 403 ならバケットが Private のまま
→ 404 ならファイルパスが間違っている
→ 音声が再生されれば OK
```

### Step 5: VPS Worker 確認
```bash
# Worker が起動しているか
sudo systemctl status tts-worker
# または
ps aux | grep tts-worker

# Worker のログ確認
sudo journalctl -u tts-worker -n 50 --no-pager
# または
node tts-worker.js  # フォアグラウンドで起動してログを直接確認

# よくあるエラー:
# "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です"
#   → .env ファイルを確認
# "[POLL ERROR]" が繰り返される
#   → Supabase への接続に失敗している
# ジョブを拾わない
#   → status=generating かつ locked_by=NULL のレコードが存在するか SQL で確認
```

### Step 6: VOICEVOX 確認
```bash
# VOICEVOX Engine が起動しているか
curl http://49.212.138.170:50021/speakers | head -c 100
# → 200 + JSON が返ればOK
# → Connection refused → Docker コンテナが起動していない

# Docker コンテナ確認
docker ps | grep voicevox
docker logs voicevox-engine --tail 20

# テスト合成
curl -s -X POST \
  "http://49.212.138.170:50021/audio_query?text=テスト&speaker=3" \
  -o /tmp/query.json -w "%{http_code}"
# → 200 が返ればOK

curl -s -X POST \
  "http://49.212.138.170:50021/synthesis?speaker=3" \
  -H "Content-Type: application/json" \
  -d @/tmp/query.json \
  -o /tmp/test.wav -w "%{http_code}"
# → 200 が返れば合成成功
# /tmp/test.wav を再生して音声が正常か確認
```

---

## 7. grep検索ワード一覧

コードベースの残骸・未実装箇所を調べるための検索ワード。

```bash
# VOICEVOX関連の参照チェック
grep -r "VOICEVOX_API_URL" src/          # Vercel側に残っていないこと
grep -r "50021" src/                      # ポート直書きが残っていないこと
grep -r "49.212.138" src/                 # VPS IP直書きが残っていないこと

# API ルート確認
grep -r "/api/tts/generate" src/          # generate API の呼出元
grep -r "/api/tts/status" src/            # status API の呼出元

# DB テーブル参照
grep -r "document_audio" src/             # document_audio の参照箇所
grep -r "document_audio_chunks" src/      # chunks の参照箇所

# Storage関連
grep -r "tts-audio" src/                  # バケット名の参照箇所
grep -r "audio_url" src/                  # audio_url の参照箇所
grep -r "storage/v1/object/public" src/   # Public URL 構築箇所

# スピーカー関連
grep -r "speaker" src/                    # speaker_id の参照箇所
grep -r "VOICE_CHARACTERS" src/           # キャラクター定義の参照箇所

# ステータス関連
grep -r "generating" src/                 # generating の参照箇所
grep -r '"ready"' src/                    # ready の参照箇所
grep -r '"failed"' src/                   # failed の参照箇所

# 旧構成の残骸チェック
grep -r "voicevox-client" src/            # 旧 VOICEVOX クライアントの参照
grep -r "generator\.ts" src/              # 旧 generator の参照
grep -r "chunker\.ts" src/                # 旧 chunker の参照
grep -r "audio_path" src/                 # 旧テーブルカラムの参照
grep -r "audioPath" src/                  # 旧変数名の参照

# 環境変数チェック
grep -r "service_role\|SERVICE_ROLE" src/ # service_role key がクライアントに漏れていないこと
grep -r "NEXT_PUBLIC_SUPABASE" src/       # 公開env変数の参照箇所
```

---

## 総合評価

**新アプリのTTS統合実装は想定以上に完成度が高い。**

- API Route（generate / status）: 完成
- フロントUI（キャラクター選択 / 生成 / ポーリング / Early Playback / シーク）: 完成
- VPS Worker（ポーリング / CAS ロック / VOICEVOX合成 / Storage アップロード）: 完成
- DB スキーマ・型定義: 整合

**「動かない」としたら、コードの問題ではなくインフラ設定の問題が最も可能性が高い:**

1. **tts-audio バケットが Public になっていない**（最重要）
2. Supabase に schema.sql が適用されていない
3. VPS Worker が起動していない / .env が正しくない
4. VOICEVOX Engine が起動していない

コード修正が必要なのは DELETE の Storage 削除処理（問題2）のみ。それ以外は Supabase Dashboard と VPS の設定作業で解決する。
