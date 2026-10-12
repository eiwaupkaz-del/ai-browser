#!/bin/bash
# ai-browser を Mac に入れる（何度実行しても大丈夫・2 回目からは更新になる）
#   使い方: bash scripts/install-mac.sh [Ollama の宛先]
#   例:     bash scripts/install-mac.sh http://192.168.1.20:11434
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="$(pwd)"
OLLAMA_URL_ARG="${1:-}"

say() { printf '\n== %s\n' "$1"; }
fail() { printf '\n✖ %s\n' "$1" >&2; exit 1; }

say "1/6 必要なものを確かめます"
command -v git >/dev/null || fail "git がありません。ターミナルで xcode-select --install を実行してから、もう一度実行してください"
if ! command -v node >/dev/null; then
  if command -v brew >/dev/null; then
    echo "Node.js がないので Homebrew で入れます"
    brew install node
  else
    fail "Node.js がありません。https://nodejs.org/ から LTS 版を入れてから、もう一度実行してください"
  fi
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js が古いです（今 $(node -v)・20 以上が必要）"
echo "git $(git --version | awk '{print $3}') / node $(node -v)"

say "2/6 最新の版にします"
if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then
  git pull --ff-only || echo "（更新できませんでした。手元で変えたファイルがあるかもしれません。このまま続けます）"
fi
echo "版: $(node -p "require('./package.json').version")"

say "3/6 部品を入れます（数分かかります）"
npm ci --no-audit --no-fund
npx playwright install chromium

say "4/6 設定ファイルを用意します（すでにあれば触りません）"
[ -f config/policy.json ] || { cp config/policy.example.json config/policy.json; echo "config/policy.json を作りました（書き込み許可リスト）"; }
if [ ! -f config/local.json ]; then
  cp config/local.example.json config/local.json
  echo "config/local.json を作りました（Ollama の宛先）"
fi
if [ -n "$OLLAMA_URL_ARG" ]; then
  node -e '
    const fs = require("fs"); const f = "config/local.json";
    const c = JSON.parse(fs.readFileSync(f, "utf8")); c.ollamaUrl = process.argv[1];
    fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");' "$OLLAMA_URL_ARG"
  echo "Ollama の宛先を $OLLAMA_URL_ARG にしました"
fi

say "5/6 動くか確かめます（テスト）"
npm test 2>&1 | grep -E "^(✔|✖|ℹ (pass|fail))" || true
npm test >/dev/null 2>&1 || fail "テストが通りませんでした。上の ✖ の行を見せてください"

say "6/6 Ollama につながるか確かめます"
OURL="$(node -p "require('./config/local.json').ollamaUrl")"
OMODEL="$(node -p "require('./config/local.json').model")"
if curl -s -m 5 "$OURL/api/tags" | grep -q "\"$OMODEL\""; then
  echo "✓ $OURL に $OMODEL があります"
else
  echo "△ $OURL の $OMODEL に届きませんでした（Ollama を使わないなら、このままで大丈夫です）"
fi

if command -v claude >/dev/null; then
  if claude mcp list 2>/dev/null | grep -q '^ai-browser'; then
    echo "✓ Claude Code にはすでに登録されています"
  else
    claude mcp add --scope user ai-browser -- node "$DIR/src/mcp-server.js" && echo "✓ Claude Code に ai-browser を登録しました"
  fi
fi

cat <<EOF

✓ 入れ終わりました: $DIR

  自宅の AI で試す:   npm run ollama -- "https://www.python.org/ を開いて最新の Python の版を答えて"
  履歴を見る:         npm run history
  許可リストを直す:   open -e config/policy.json
EOF
