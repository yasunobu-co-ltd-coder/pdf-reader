# VPS TTS Worker セットアップ手順 — PDF-reader 用

PDF読み上げアプリ (PDF-reader) の VOICEVOX 音声生成ワーカーを VPS にデプロイする手順。

---

## 構成ファイル一覧

| ファイル | 役割 |
|---------|------|
| `tts-worker-pdfreader.js` | ワーカー本体（Supabase ポーリング + VOICEVOX 合成） |
| `pdf-reader.env` | 環境変数 |
| `package.json` | 依存パッケージ定義 |

---

## 参照する Supabase テーブル

Worker が参照するテーブルは既にアプリ側で作成済み（`supabase/schema.sql` 参照）。

### `document_audio`（ジョブ管理）

| カラム | 型 | 用途 |
|--------|------|------|
| `id` | UUID | PK |
| `document_id` | UUID | 対象ドキュメント |
| `text_hash` | TEXT | テキストの SHA-256（差分生成用） |
| `status` | TEXT | generating / processing / ready / failed |
| `speaker_id` | INT | VOICEVOX キャラ ID |
| `total_chunks` | INT | 全チャンク数 |
| `completed_chunks` | INT | 完了チャンク数 |
| `current_chunk_index` | INT | 処理中チャンク |
| `progress_text` | TEXT | 進捗メッセージ |
| `duration_sec` | REAL | 合計音声長 |
| `locked_by` | TEXT | ワーカーID（排他ロック） |
| `processing_started_at` | TIMESTAMPTZ | 処理開始時刻 |

### `document_audio_chunks`（チャンク）

| カラム | 型 | 用途 |
|--------|------|------|
| `id` | UUID | PK |
| `audio_id` | UUID | FK → document_audio.id |
| `chunk_index` | INT | チャンク順序 |
| `chunk_text` | TEXT | テキスト内容 |
| `audio_url` | TEXT | Storage パス |
| `duration_sec` | REAL | 音声長 |

### Storage バケット

- バケット名: `tts-audio`（Public）
- パスパターン: `tts/{document_id}/{audio_id}/chunk_{index}.wav`

---

## 環境変数（pdf-reader.env）

```env
# === PDF-reader 用 ===
TABLE_NAME=document_audio_chunks
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
VOICEVOX_BASE=http://127.0.0.1:50021
VOICEVOX_SPEAKER_ID=3
POLL_INTERVAL_MS=3000
PROGRESS_UPDATE_INTERVAL=3
STALE_JOB_TIMEOUT_MIN=10
CONCURRENCY=2
```

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `TABLE_NAME` | チャンクテーブル名 | — |
| `SUPABASE_URL` | Supabase プロジェクト URL | — |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（RLS バイパス） | — |
| `VOICEVOX_BASE` | VOICEVOX Engine の URL | `http://localhost:50021` |
| `VOICEVOX_SPEAKER_ID` | デフォルト話者 ID（ジョブに未指定時のフォールバック） | `1` |
| `POLL_INTERVAL_MS` | ポーリング間隔（ms） | `3000` |
| `PROGRESS_UPDATE_INTERVAL` | N チャンクごとに DB 進捗更新 | `3` |
| `STALE_JOB_TIMEOUT_MIN` | 滞留ジョブの解放タイムアウト（分） | `10` |
| `CONCURRENCY` | 同時チャンク処理数 | `2` |

> 2GB VPS の場合は `CONCURRENCY=1` に下げること。

---

## VPS セットアップ手順

### 前提条件

| 項目 | 最低 | 推奨 |
|------|------|------|
| メモリ | 2GB | 4GB |
| CPU | 2コア | 4コア |
| ストレージ | 20GB | 40GB |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 |
| Node.js | 20+ | — |

---

### STEP 1: Docker + VOICEVOX ENGINE

```bash
# Docker インストール
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# ログアウト → 再ログイン

# VOICEVOX 起動（CPU版）
docker pull voicevox/voicevox_engine:cpu-latest
docker run -d \
  --name voicevox \
  --restart always \
  -p 50021:50021 \
  voicevox/voicevox_engine:cpu-latest

# 確認
curl http://localhost:50021/version
```

### STEP 2: Node.js インストール

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # v20.x.x
```

### STEP 3: Worker 配置

```bash
mkdir -p ~/tts-worker && cd ~/tts-worker

# ローカルから必要ファイルをアップロード
# 対象: vps-tts-worker-pdfreader/ 配下の3ファイル
scp tts-worker-pdfreader.js pdf-reader.env package.json user@VPS_IP:~/tts-worker/

# 依存インストール
npm install
```

### STEP 4: pdf-reader.env を編集

```bash
nano pdf-reader.env
# SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を本番値に設定
```

### STEP 5: テスト起動

```bash
node tts-worker-pdfreader.js
# [WORKER] xxx started
# [VOICEVOX] http://127.0.0.1:50021
# → 上記が出れば接続OK
# → アプリから音声生成を実行してジョブが処理されることを確認
# → Ctrl+C で停止
```

### STEP 6: systemd サービス化

```bash
sudo tee /etc/systemd/system/tts-worker-pdfreader.service << 'EOF'
[Unit]
Description=TTS Worker for PDF-reader
After=network.target docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/tts-worker
ExecStart=/usr/bin/node tts-worker-pdfreader.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tts-worker-pdfreader
sudo systemctl start tts-worker-pdfreader

# 確認
sudo systemctl status tts-worker-pdfreader
```

---

## VPS ディレクトリ構成（pocket系と共存する場合）

```
~/tts-worker/
  tts-worker.js              ← pocket系共用ワーカー（既存）
  tts-worker-pdfreader.js     ← PDF-reader 用ワーカー（今回追加）
  package.json                ← 共用
  node_modules/               ← 共用

  matip.env                   ← pocket-matip 用（既存）
  yasunobu.env                ← pocket-yasunobu 用（既存）
  pdf-reader.env              ← PDF-reader 用（今回追加）
```

```bash
# systemd サービスは別々
sudo systemctl start tts-worker-matip       # → tts-worker.js（matip.env）
sudo systemctl start tts-worker-yasunobu    # → tts-worker.js（yasunobu.env）
sudo systemctl start tts-worker-pdfreader   # → tts-worker-pdfreader.js（pdf-reader.env）
```

> VOICEVOX ENGINE は全ワーカーで共有（1インスタンス、ポート50021）。

---

## 運用コマンド

```bash
# ワーカー状態一覧
sudo systemctl list-units 'tts-worker-*'

# ログ確認
sudo journalctl -u tts-worker-pdfreader -f

# 再起動
sudo systemctl restart tts-worker-pdfreader

# VOICEVOX 状態確認
curl http://localhost:50021/version
docker ps | grep voicevox

# VOICEVOX 再起動（OOM時等）
docker restart voicevox
```

---

## トラブルシューティング

### ジョブが処理されない

```bash
# 1. VOICEVOX が動いているか
curl http://localhost:50021/version

# 2. ワーカーが動いているか
sudo systemctl status tts-worker-pdfreader

# 3. ジョブが DB にあるか
# → Supabase Table Editor で document_audio の status=generating を確認
```

### OOM でジョブが途中失敗する

```bash
# CONCURRENCY を 1 に下げる
# pdf-reader.env: CONCURRENCY=1

# 両方再起動
docker restart voicevox
sudo systemctl restart tts-worker-pdfreader
```

### failed ジョブの再実行

```sql
UPDATE document_audio
SET status = 'generating', locked_by = NULL,
    processing_started_at = NULL, completed_chunks = 0,
    current_chunk_index = 0, error_message = NULL
WHERE status = 'failed';
```

---

## チェックリスト

### DB / Storage
- [ ] `document_audio` テーブルが存在する
- [ ] `document_audio_chunks` テーブルが存在する
- [ ] Storage バケット `tts-audio` が Public で作成されている

### VPS
- [ ] Docker + VOICEVOX ENGINE が `--restart always` で起動
- [ ] Node.js 20+ がインストール済み
- [ ] `npm install` 済み
- [ ] `pdf-reader.env` に正しい Supabase 接続情報がある

### Worker
- [ ] テスト起動でポーリング開始を確認
- [ ] アプリからジョブ発行 → 音声生成 → Storage アップロードの一連動作を確認
- [ ] systemd サービスが `enabled` + `active (running)`
- [ ] `journalctl` でエラーが出ていない
