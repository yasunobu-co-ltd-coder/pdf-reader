# VPS セットアップ手順書

PDF読み上げアプリの音声生成基盤（VOICEVOX Engine + TTS Worker）をVPSに構築する手順。

## 現在の構成情報

| 項目 | 値 |
|------|-----|
| VPS IP | `49.212.138.170` |
| VOICEVOX ポート | `50021`（IP直接公開、Basic認証なし） |
| Supabase URL | `https://lswmpnrqhjcbicvhexla.supabase.co` |

---

## 1. 前提条件

| 項目 | 要件 |
|------|------|
| OS | Ubuntu 22.04 LTS 以上（推奨） |
| CPU | 2コア以上 |
| メモリ | 4GB以上（VOICEVOX Engine が約2GB使用） |
| ストレージ | 20GB以上（Dockerイメージ + 一時WAVファイル） |
| ネットワーク | Supabase への HTTPS アウトバウンド通信が可能 |
| Node.js | v18 以上 |
| Docker | Docker Engine 24.x 以上 + Docker Compose v2 |

---

## 2. サーバー初期設定

### 2-1. パッケージ更新

```bash
sudo apt update && sudo apt upgrade -y
```

### 2-2. Docker インストール

```bash
# Docker公式リポジトリ追加
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 現在のユーザーをdockerグループに追加（sudo不要にする）
sudo usermod -aG docker $USER
newgrp docker
```

### 2-3. Node.js インストール

```bash
# NodeSource から Node.js 20.x をインストール
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# バージョン確認
node -v   # v20.x.x
npm -v    # 10.x.x
```

---

## 3. VOICEVOX Engine セットアップ

### 3-1. Docker Compose ファイル作成

```bash
mkdir -p ~/voicevox && cd ~/voicevox
```

`docker-compose.yml` を作成:

```yaml
version: "3.8"

services:
  voicevox-engine:
    image: voicevox/voicevox_engine:cpu-latest
    container_name: voicevox-engine
    ports:
      - "0.0.0.0:50021:50021"
    environment:
      - VV_CPU_NUM_THREADS=2
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 3G
```

> **ポートバインドについて:**
> 現在の構成では `0.0.0.0:50021` で外部に直接公開しています（Basic認証なし）。
> Worker が同一VPS上で動作する場合は `127.0.0.1:50021` に変更し、
> ファイアウォールで 50021 を閉じるとよりセキュアです。

> **GPU版を使う場合:**
> イメージを `voicevox/voicevox_engine:nvidia-latest` に変更し、
> `docker-compose.yml` に以下を追加:
> ```yaml
>     deploy:
>       resources:
>         reservations:
>           devices:
>             - driver: nvidia
>               count: 1
>               capabilities: [gpu]
> ```

### 3-2. VOICEVOX 起動

```bash
cd ~/voicevox
docker compose up -d
```

### 3-3. 動作確認

```bash
# ヘルスチェック（話者一覧が返ればOK）
curl http://49.212.138.170:50021/speakers | head -c 200

# テスト音声生成
curl -s -X POST "http://49.212.138.170:50021/audio_query?text=テスト&speaker=3" \
  -H "Content-Type: application/json" \
  -o /dev/null -w "audio_query: %{http_code}\n"
```

`200` が返れば正常。

---

## 4. TTS Worker セットアップ

### 4-1. ソースコード配置

```bash
# リポジトリをクローン（Worker部分のみ使用）
cd ~
git clone https://github.com/yasunobu-co-ltd-coder/pdf-reader.git
cd pdf-reader/vps-tts-worker
```

### 4-2. 依存パッケージインストール

```bash
npm install
```

### 4-3. 環境変数設定

```bash
cp .env.example .env
nano .env
```

以下を実際の値に書き換える:

```env
# Supabase (service_role key で RLS バイパス)
SUPABASE_URL=https://lswmpnrqhjcbicvhexla.supabase.co
SUPABASE_SERVICE_ROLE_KEY=（Supabase Dashboard → Settings → API → service_role key）

# VOICEVOX Engine
# 同一VPSなら localhost、別サーバーならIPを指定
VOICEVOX_API_URL=http://49.212.138.170:50021

# Worker 設定
POLL_INTERVAL_MS=3000
CONCURRENCY=2
STALE_TIMEOUT_MIN=10
```

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `SUPABASE_URL` | Supabase プロジェクトURL | **必須** |
| `SUPABASE_SERVICE_ROLE_KEY` | サービスロールキー（RLSバイパス） | **必須** |
| `VOICEVOX_API_URL` | VOICEVOX Engine のURL | `http://localhost:50021` |
| `POLL_INTERVAL_MS` | ポーリング間隔（ミリ秒） | `3000` |
| `CONCURRENCY` | 並列チャンク処理数 | `2` |
| `STALE_TIMEOUT_MIN` | staleジョブ回復タイムアウト（分） | `10` |
| `WORKER_ID` | Worker識別子（ログ・ロック用） | `hostname-PID` |

> Worker が VOICEVOX と同一VPS上にある場合は `VOICEVOX_API_URL=http://localhost:50021` でも可。

### 4-4. 動作テスト（フォアグラウンド）

```bash
node tts-worker.js
```

以下のようなログが出れば正常:

```
[WORKER] my-vps-12345 started
  VOICEVOX: http://49.212.138.170:50021
  POLL: 3000ms, CONCURRENCY: 2
  STALE TIMEOUT: 10min
```

`Ctrl+C` で停止。

---

## 5. systemd サービス化（自動起動）

### 5-1. サービスファイル作成

```bash
sudo nano /etc/systemd/system/tts-worker.service
```

```ini
[Unit]
Description=TTS Worker - VOICEVOX Audio Generator
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/pdf-reader/vps-tts-worker
ExecStart=/usr/bin/node tts-worker.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tts-worker

# 環境変数ファイル
EnvironmentFile=/home/ubuntu/pdf-reader/vps-tts-worker/.env

# プロセス制限
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

> `User` と `WorkingDirectory` は実際のユーザー名・パスに合わせて変更してください。

### 5-2. サービス有効化・起動

```bash
sudo systemctl daemon-reload
sudo systemctl enable tts-worker
sudo systemctl start tts-worker
```

### 5-3. ステータス確認

```bash
# サービス状態
sudo systemctl status tts-worker

# リアルタイムログ
sudo journalctl -u tts-worker -f

# 最近のログ（100行）
sudo journalctl -u tts-worker -n 100 --no-pager
```

### 5-4. 操作コマンド一覧

```bash
sudo systemctl start tts-worker     # 起動
sudo systemctl stop tts-worker      # 停止
sudo systemctl restart tts-worker   # 再起動
sudo systemctl status tts-worker    # 状態確認
```

---

## 6. VOICEVOX の systemd 管理（任意）

Docker Compose の自動起動に加えて、systemd で管理する場合:

```bash
sudo nano /etc/systemd/system/voicevox.service
```

```ini
[Unit]
Description=VOICEVOX Engine (Docker)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=ubuntu
WorkingDirectory=/home/ubuntu/voicevox
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable voicevox
```

---

## 7. Supabase 側の設定

### 7-1. Storage バケット作成

Supabase Dashboard（https://supabase.com/dashboard/project/lswmpnrqhjcbicvhexla）→ Storage で以下のバケットを作成:

| バケット名 | 公開設定 | 用途 |
|-----------|---------|------|
| `pdfs` | Private | PDF原本 |
| `tts-audio` | **Public** | 生成音声WAV |

> `tts-audio` は Public にする（フロントエンドから直接音声URLを再生するため）。
> パス規約: `tts/{documentId}/{audioId}/chunk_{index}.wav`

### 7-2. Storage ポリシー設定

`tts-audio` バケットの RLS ポリシー:

- **SELECT (read)**: `true`（Public 読み取り）
- **INSERT**: `service_role` のみ（Worker が書き込み）
- **DELETE**: `service_role` のみ

Dashboard → Storage → Policies で設定するか、SQL で:

```sql
-- tts-audio バケットの公開読み取りポリシー
CREATE POLICY "public_read_tts_audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tts-audio');
```

### 7-3. service_role key の取得

Supabase Dashboard → Settings → API:

- **Project URL** → `https://lswmpnrqhjcbicvhexla.supabase.co`（設定済み）
- **service_role key**（秘密鍵）→ Worker の `.env` の `SUPABASE_SERVICE_ROLE_KEY` に設定

> **注意**: `service_role key` は RLS をバイパスする強力な鍵です。
> VPS の `.env` ファイルにのみ保存し、フロントエンドやGitリポジトリには絶対に含めないでください。

### 7-4. DBスキーマ適用

`supabase/schema.sql` を Supabase の SQL Editor で実行:

Supabase Dashboard → SQL Editor → New Query → `schema.sql` の内容を貼り付けて Run。

---

## 8. Vercel 側の環境変数

Vercel Dashboard → Settings → Environment Variables:

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lswmpnrqhjcbicvhexla.supabase.co` | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIs...` | サーバー側 API Route 用 |

> Vercel 側に VOICEVOX 関連の環境変数は **不要** です（音声生成はVPS Worker が担当）。
> `.env.local.example` にある `VOICEVOX_API_URL` は旧構成の名残で、現在のコードでは使用されません。

---

## 9. 動作確認フロー

### 全体の流れ

```
ユーザー → Vercel (Next.js)
  1. PDF アップロード → テキスト抽出 → documents テーブル
  2. 「音声を生成する」ボタン → /api/tts/generate
     → document_audio テーブルに status=generating のジョブ作成
     → document_audio_chunks テーブルにチャンクレコード作成

VPS (49.212.138.170) — tts-worker.js
  3. 3秒ごとに Supabase の document_audio をポーリング
  4. status=generating, locked_by=NULL のジョブを CAS ロック取得
  5. 各チャンクを VOICEVOX (49.212.138.170:50021) で音声合成
     audio_query → synthesis → WAV バッファ
  6. Supabase Storage (tts-audio) にアップロード
  7. チャンクレコードに audio_url を書き込み
  8. 全チャンク完了 → status=ready に更新

フロントエンド
  9. 2秒ポーリングで /api/tts/status を監視
  10. audio_url が入ったチャンクから順次再生可能（Early Playback）
```

### 確認手順

1. **VOICEVOX 起動確認**
   ```bash
   curl http://49.212.138.170:50021/speakers | python3 -m json.tool | head -20
   ```

2. **Worker 起動確認**
   ```bash
   sudo systemctl status tts-worker
   sudo journalctl -u tts-worker -n 20
   ```

3. **エンドツーエンドテスト**
   - ブラウザでアプリにログイン
   - PDFをアップロード
   - 文書詳細画面でキャラクターを選択 →「音声を生成する」をクリック
   - プログレスバーが進行し、チャンクが順次再生可能になることを確認
   - 全チャンク完了後、シークバーで任意位置にジャンプできることを確認

4. **Worker ログで生成状況を確認**
   ```bash
   sudo journalctl -u tts-worker -f
   ```
   正常時の出力例:
   ```
   [START] Job abc123 (speaker=3, chunks=12)
     [CHUNK] 0/11 done (3.2s)
     [CHUNK] 1/11 done (2.8s)
     ...
   [DONE] Job abc123 — total 35.4s
   ```

---

## 10. トラブルシューティング

### VOICEVOX が起動しない

```bash
# コンテナログ確認
docker logs voicevox-engine

# メモリ不足の場合
free -h
# → メモリ4GB未満なら swap を追加
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### VOICEVOX に外部から接続できない

```bash
# ポートが開いているか確認
ss -tlnp | grep 50021

# ファイアウォールで許可されているか確認
sudo ufw status
sudo ufw allow 50021/tcp   # 必要に応じて

# Docker のポートバインド確認
docker port voicevox-engine
# → 0.0.0.0:50021 -> 50021/tcp であること
```

### Worker がジョブを取得しない

```bash
# .env の SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を確認
cat ~/pdf-reader/vps-tts-worker/.env

# Supabase に接続できるか確認
curl -s "https://lswmpnrqhjcbicvhexla.supabase.co/rest/v1/document_audio?status=eq.generating&locked_by=is.null&select=id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

### 音声合成がタイムアウトする

```bash
# VOICEVOX の応答時間テスト
time curl -s -X POST \
  "http://49.212.138.170:50021/audio_query?text=これはテストです&speaker=3" \
  -o /tmp/query.json

time curl -s -X POST \
  "http://49.212.138.170:50021/synthesis?speaker=3" \
  -H "Content-Type: application/json" \
  -d @/tmp/query.json \
  -o /tmp/test.wav

# 10秒以上かかる場合は CPU スレッド数を調整
# docker-compose.yml の VV_CPU_NUM_THREADS を増やす
```

### stale ジョブが溜まる

Worker が異常終了するとロックされたジョブが残る。Worker が自動的に10分後に回復するが、手動で解放する場合:

```sql
-- Supabase SQL Editor で実行
UPDATE document_audio
SET status = 'generating', locked_by = NULL, processing_started_at = NULL
WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '10 minutes';
```

---

## 11. セキュリティに関する注意

### 現在の構成のリスク

現在 VOICEVOX Engine が `0.0.0.0:50021` で外部に公開されています。
VOICEVOX 自体に認証機能はないため、第三者が直接アクセスして音声合成APIを利用できる状態です。

### 推奨対策

Worker が同一VPS上で動作する場合、VOICEVOX を localhost のみに制限:

```yaml
# docker-compose.yml を変更
ports:
  - "127.0.0.1:50021:50021"   # localhost のみ
```

```bash
# 変更を適用
cd ~/voicevox
docker compose up -d

# ファイアウォールで 50021 を閉じる
sudo ufw deny 50021/tcp
```

Worker の `.env` は `VOICEVOX_API_URL=http://localhost:50021` に変更。

### チェックリスト

- [ ] `.env` ファイルが `chmod 600` で保護されている
- [ ] `service_role key` がGitリポジトリに含まれていない（`.gitignore` 確認）
- [ ] VOICEVOX Engine のアクセス制限を検討済み
- [ ] SSH は鍵認証のみ（パスワード認証無効化）
- [ ] ファイアウォール（ufw）で不要ポートを閉じている
- [ ] Supabase の `tts-audio` バケットは読み取りのみ Public

```bash
# .env のパーミッション確認・設定
chmod 600 ~/pdf-reader/vps-tts-worker/.env

# ファイアウォール設定例
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw enable
sudo ufw status
```

---

## 12. 更新・デプロイ手順

Worker コードを更新する場合:

```bash
cd ~/pdf-reader
git pull origin main
cd vps-tts-worker
npm install
sudo systemctl restart tts-worker
sudo journalctl -u tts-worker -f   # ログ確認
```

VOICEVOX Engine を更新する場合:

```bash
cd ~/voicevox
docker compose pull
docker compose up -d
curl http://49.212.138.170:50021/speakers | head -c 100   # 動作確認
sudo systemctl restart tts-worker   # Worker も再起動
```
