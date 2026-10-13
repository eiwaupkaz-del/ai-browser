#!/bin/bash
# 鍵（API キー）を macOS のキーチェーンに入れる。画面には表示されない（2 回聞かれる）。
#   bash scripts/set-secret.sh anthropic-admin
#   bash scripts/set-secret.sh openai-admin
#   bash scripts/set-secret.sh xai-management
#   鍵ファイル: bash scripts/set-secret.sh --file google-sa ~/Downloads/鍵.json
#   消す: bash scripts/set-secret.sh --delete anthropic-admin
set -euo pipefail
SERVICE="ai-browser"
if [ "${1:-}" = "--delete" ]; then
  security delete-generic-password -s "$SERVICE" -a "${2:?名前がありません}" >/dev/null && echo "✓ ${2} を消しました"
  exit 0
fi
if [ "${1:-}" = "--file" ]; then
  # 鍵ファイル（Google のサービスアカウントの JSON など）を入れる。入れたあと元のファイルを消すか聞く
  NAME="${2:?名前がありません}"; FILE="${3:?ファイルがありません}"
  [[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "名前は英小文字・数字・- だけ" >&2; exit 1; }
  [ -f "$FILE" ] || { echo "ファイルがありません: ${FILE}" >&2; exit 1; }
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!j.client_email||!j.private_key) process.exit(2); console.log("専用アカウント: "+j.client_email)' "$FILE" || { echo "サービスアカウントの鍵 JSON ではないようです" >&2; exit 1; }
  security add-generic-password -U -s "$SERVICE" -a "$NAME" -T /usr/bin/security -w "$(base64 < "$FILE" | tr -d '\n')"
  echo "✓ ${NAME} をキーチェーンに入れました"
  read -r -p "元のファイル（${FILE}）を消しますか？ [y/N] " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then rm -P "$FILE" 2>/dev/null || rm -f "$FILE"; echo "✓ 消しました"; fi
  exit 0
fi
NAME="${1:?使い方: bash scripts/set-secret.sh <名前>（anthropic-admin / openai-admin / xai-management）}"
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "名前は英小文字・数字・- だけ" >&2; exit 1; }
echo "「${NAME}」の鍵を貼り付けて Enter を押してください（画面には出ません）。"
# -w を最後に置くと、security が見えない形で聞いてくれる（鍵がコマンドの文字に残らない）
security add-generic-password -U -s "$SERVICE" -a "$NAME" -T /usr/bin/security -w
echo "✓ ${NAME} をキーチェーンに入れました"
