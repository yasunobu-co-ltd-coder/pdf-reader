# VPS TTS Worker 実行コマンド — PDF-reader 用

順番に上から実行する。各コマンドの実行場所（ローカル / VPS）を明記。

---

## 1. VPS 初期セットアップ

### 1-1. VPS に SSH 接続

```bash
# [ローカル]
ssh ubuntu@49.212.138.170
```

### 1-2. Docker インストール

```bash
# [VPS]
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

```bash
# [VPS] ログアウトして再ログイン（docker グループ反映）
exit
```

```bash
# [ローカル]
ssh ubuntu@49.212.138.170
```

### 1-3. VOICEVOX ENGINE 起動

```bash
# [VPS]
docker pull voicevox/voicevox_engine:cpu-latest
```

```bash
# [VPS]
docker run -d \
  --name voicevox \
  --restart always \
  -p 50021:50021 \
  voicevox/voicevox_engine:cpu-latest
```

```bash
# [VPS] 起動確認
curl http://localhost:50021/version
```

### 1-4. Node.js インストール

```bash
# [VPS]
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

```bash
# [VPS] バージョン確認
node -v
```

---

## 2. Worker ファイル配置

### 2-1. ディレクトリ作成

```bash
# [VPS]
mkdir -p ~/tts-worker
```

### 2-2. ファイルをアップロード

```bash
# [ローカル] vps-tts-worker-pdfreader/ から3ファイルを転送
scp pdf-reader/vps-tts-worker-pdfreader/tts-worker-pdfreader.js ubuntu@49.212.138.170:~/tts-worker/
scp pdf-reader/vps-tts-worker-pdfreader/pdf-reader.env ubuntu@49.212.138.170:~/tts-worker/
scp pdf-reader/vps-tts-worker-pdfreader/package.json ubuntu@49.212.138.170:~/tts-worker/
```

### 2-3. 依存パッケージインストール

```bash
# [VPS]
cd ~/tts-worker && npm install
```

---

## 3. 環境変数の確認・編集

### 3-1. pdf-reader.env を確認

```bash
# [VPS]
cat ~/tts-worker/pdf-reader.env
```

### 3-2. 必要に応じて編集

```bash
# [VPS] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が正しいか確認
nano ~/tts-worker/pdf-reader.env
```

---

## 4. テスト起動

### 4-1. フォアグラウンドで起動

```bash
# [VPS]
cd ~/tts-worker && node tts-worker-pdfreader.js
```

> `[WORKER] xxx started` と表示されれば接続OK。
> アプリから音声生成を実行してジョブが処理されることを確認。
> 確認後 `Ctrl+C` で停止。

---

## 5. systemd サービス化

### 5-1. サービスファイル作成

```bash
# [VPS]
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
```

### 5-2. サービス有効化 & 起動

```bash
# [VPS]
sudo systemctl daemon-reload
sudo systemctl enable tts-worker-pdfreader
sudo systemctl start tts-worker-pdfreader
```

### 5-3. 起動確認

```bash
# [VPS]
sudo systemctl status tts-worker-pdfreader
```

### 5-4. ログ確認

```bash
# [VPS]
sudo journalctl -u tts-worker-pdfreader -f
```

---

## 6. 動作確認チェック

```bash
# [VPS] VOICEVOX が動いているか
curl http://localhost:50021/version

# [VPS] ワーカーが動いているか
sudo systemctl status tts-worker-pdfreader

# [VPS] 全 tts-worker の状態一覧
sudo systemctl list-units 'tts-worker-*'
```

---

## 補足: 再起動・メンテナンス

```bash
# [VPS] ワーカー再起動
sudo systemctl restart tts-worker-pdfreader

# [VPS] VOICEVOX 再起動（OOM時等）
docker restart voicevox

# [VPS] ワーカー停止
sudo systemctl stop tts-worker-pdfreader
```
