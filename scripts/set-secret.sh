#!/bin/bash
# 鍵（API キー）を macOS のキーチェーンに入れる。画面には表示されない（2 回聞かれる）。
#   bash scripts/set-secret.sh anthropic-admin
#   bash scripts/set-secret.sh openai-admin
#   bash scripts/set-secret.sh xai-management
#   消す: bash scripts/set-secret.sh --delete anthropic-admin
set -euo pipefail
SERVICE="ai-browser"
if [ "${1:-}" = "--delete" ]; then
  security delete-generic-password -s "$SERVICE" -a "${2:?名前がありません}" >/dev/null && echo "✓ ${2} を消しました"
  exit 0
fi
NAME="${1:?使い方: bash scripts/set-secret.sh <名前>（anthropic-admin / openai-admin / xai-management）}"
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "名前は英小文字・数字・- だけ" >&2; exit 1; }
echo "「${NAME}」の鍵を貼り付けて Enter を押してください（画面には出ません）。"
# -w を最後に置くと、security が見えない形で聞いてくれる（鍵がコマンドの文字に残らない）
security add-generic-password -U -s "$SERVICE" -a "$NAME" -T /usr/bin/security -w
echo "✓ ${NAME} をキーチェーンに入れました"
