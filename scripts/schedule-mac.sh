#!/bin/bash
# 定期チェック（npm run digest）を毎日決まった時刻に動かす（macOS の launchd を使う）
#   入れる:   bash scripts/schedule-mac.sh 19:00
#   やめる:   bash scripts/schedule-mac.sh off
#   今すぐ試す: launchctl kickstart gui/$(id -u)/io.github.ai-browser.digest
# Mac が眠っていたときは、起きたあとに 1 回動きます。
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
LABEL="io.github.ai-browser.digest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ARG="${1:-19:00}"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$ARG" = "off" ]; then
  rm -f "$PLIST"
  echo "✓ 定期チェックをやめました"
  exit 0
fi
[[ "$ARG" =~ ^([0-9]{1,2}):([0-9]{2})$ ]] || { echo "時刻は 19:00 の形で書いてください" >&2; exit 1; }
HOUR=$((10#${BASH_REMATCH[1]})); MIN=$((10#${BASH_REMATCH[2]}))
NODE="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/bin/digest.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MIN</integer></dict>
  <key>StandardOutPath</key><string>$DIR/data/logs/digest.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/logs/digest.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict>
</plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
printf '✓ 毎日 %02d:%02d に定期チェックを動かします（%s）\n' "$HOUR" "$MIN" "$PLIST"
