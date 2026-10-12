# ai-browser

AI がウェブを見るための専用ブラウザーです。Playwright（Chromium）を MCP サーバーとして動かします。

- **閲覧は自由**：どのサイトでも開いて読めます。
- **書き込み・送信は許可リストだけ**：文字の入力や送信は、あらかじめ決めた URL だけでできます。
- **すべて履歴に残る**：どの AI が、いつ、何をしたか、断ったこと・止めた通信まで、あとで確認できます。
- **Claude でも自宅の AI でも使える**：Claude Code などは MCP で、Ollama（例 `qwen3:14b`）は付属の入口で、同じ道具を使います。

> English: A dedicated, policy-enforced browser for AI agents. Browsing is unrestricted, but any write action (typing, form submission, non-GET requests, WebSockets) is only allowed on URLs in an explicit allowlist. Every action is logged to append-only JSONL history with screenshots. Works as an MCP server (Claude, etc.) and with local LLMs via Ollama tool calling.

## 守りのしくみ

守りは 2 段になっています。AI がうっかり（またはページにだまされて）送信しようとしても、2 段目で止まります。

| 段 | 何を止めるか | 許可リストのページ | ほかのページ |
|---|---|---|---|
| 1. 操作 | 文字の入力・選択・Enter キー・POST の送信ボタン | できる | 断る（検索欄への入力だけは可） |
| 2. 通信 | POST・PUT・DELETE などの送信、WebSocket | 通す | 止める |
| いつも | パスワード欄への入力 | 断る | 断る |
| いつも | `file:`・`localhost`・自宅のネットワーク（192.168.* など）を開く | 断る | 断る |
| いつも | ファイルのダウンロード | しない | しない |

- 送信の通信を通すかどうかは「送り先」ではなく「いま開いているページ」で決めます。許可リスト外のページが、許可リストのサイトへこっそり送ろうとしても止まります。
- ページの文章に書かれた命令に従わないように、自宅の AI 用の指示文にも書いてあります。

## 入れ方

Node.js 20 以上が必要です。

```bash
git clone https://github.com/eiwaupkaz-del/ai-browser.git
```

```bash
cd ai-browser && npm install && npx playwright install chromium
```

設定ファイルを見本から作ります（どちらも Git には入りません）。

```bash
cp config/policy.example.json config/policy.json
```

```bash
cp config/local.example.json config/local.json
```

### 書き込み許可リスト

`config/policy.json` の `writeAllowlist` に書きます。`*` は「何でも」です。保存すればすぐ効きます（再起動はいりません）。

```json
"writeAllowlist": [
  { "pattern": "https://example.com/contact/*", "note": "問い合わせフォーム" }
]
```

### ログインが必要なサイト

AI はパスワードを入れません。人が手でログインします。

```bash
npm run login -- https://example.com/login
```

開いた窓でログインして、窓を閉じます。ログインの状態は `data/profile-main/` に残ります（AI の道具が動いていないときに行ってください）。

## 使い方

### Claude Code から（MCP）

```bash
claude mcp add ai-browser -- node /path/to/ai-browser/src/mcp-server.js
```

### 自宅の AI（Ollama）から

`config/local.json` に Ollama の宛先とモデルを書いて：

```bash
npm run ollama -- "○○市のお知らせのページを開いて、今週の新しいお知らせを 3 つまとめて"
```

### 道具の一覧

`open_url`・`search_web`・`read_page`・`list_elements`・`click`・`type_text`・`select_option`・`press_key`・`scroll`・`go_back`・`screenshot`・`list_tabs`・`switch_tab`・`write_permission`・`recent_history`

## 履歴を見る

```bash
npm run history
```

```bash
npm run history -- --blocked --days 7
```

```bash
npm run history -- --html --days 7
```

- 履歴は `data/history/日付.jsonl` に 1 行 1 件で追記されます（消したり書き換えたりしません）。
- 書き込みの操作（許されたものも断ったものも）は、そのときの画面も `data/history/日付/shots/` に残ります。
- `--html` は画像つきの一覧を作ってブラウザーで開きます。

## 設定（環境変数）

| 名前 | 意味 | 既定 |
|---|---|---|
| `AIB_POLICY` | 決まりのファイル | `config/policy.json`（なければ見本） |
| `AIB_PROFILE` | ブラウザーのプロファイル名 | `main` |
| `AIB_HEADED` | `1` で窓を出して動かす | 窓なし |
| `AIB_CLIENT` | 履歴に残す使い手の名前 | `mcp` |
| `AIB_HISTORY_DIR` | 履歴の置き場 | `data/history` |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Ollama の宛先とモデル | `config/local.json` |

## テスト

```bash
npm test
```

手元に小さなサーバーを立てて、本物の Chromium で「許可リスト外では入力も送信も止まる」「許可リストでは送れる」「履歴に残る」を確かめます。

## 気をつけること

- 自宅のネットワークを止めるのは URL の宛先（IP の形・`.local` など）で判断します。名前から自宅の IP に変わる宛先（DNS rebinding）までは見ていません。
- 許可リストのサイトでは、AI が入力・送信できます。本当に必要な URL だけを、できるだけ細かく書いてください。

## ライセンス

[Apache License 2.0](LICENSE)
