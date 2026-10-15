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
git clone https://github.com/eiwaupkaz-del/ai-browser.git ~/ai-browser
```

```bash
bash ~/ai-browser/scripts/install-mac.sh http://<Ollama の宛先>:11434
```

`install-mac.sh` は、部品と Chromium を入れ、設定ファイルを見本から作り（`config/policy.json`・`config/local.json`。どちらも Git には入りません）、テストと Ollama への接続を確かめます。何度実行しても大丈夫で、2 回目からは更新になります。

> **iCloud に注意**：デスクトップや書類のフォルダーを iCloud で同期している Mac では、そこに置かないでください。履歴とブラウザーのログイン情報（`data/`）が他の Mac と混ざります。`~/ai-browser` のように、同期されない場所に置きます。

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

### 定期チェック（決まった時刻に見てまとめる）

`config/digest.json`（なければ見本 `config/digest.example.json`）に書いたサイトを順に開きます。前回から増えたリンクを「新着」として、自宅の AI がまとめます。新着のないサイトは載せず、どこにも新着がなければ投稿しません。まとめは `data/reports/digest-日付.md` に保存され、Mac の通知も出ます。

```bash
npm run digest
```

毎日 19:00 に動かすときは、次のように入れます（macOS の launchd を使います）。

```bash
bash scripts/schedule-mac.sh 19:00
```

やめるときは `bash scripts/schedule-mac.sh off` です。

### AI の API 使用量の見張り（毎日）

Claude（Anthropic）・OpenAI・xAI・Google（Gemini）の API の使用量を毎日集め、分析して報告します。

| 会社 | 取り方 | 用意するもの |
|---|---|---|
| Claude | Admin API の Usage & Cost | 管理者用の鍵 `anthropic-admin` |
| OpenAI | Usage API と Costs API | 管理者用の鍵 `openai-admin`（読むだけの権限で） |
| xAI | Management API の billing | 管理用の鍵 `xai-management`（Billing を読むだけ）と、`config/usage.json` のチーム ID |
| Google | Google Cloud の請求データの書き出し（BigQuery）を、読むだけの専用アカウントで読む | 請求データの BigQuery への書き出しと、サービスアカウントの鍵 `google-sa`（`bash scripts/set-secret.sh --file google-sa 鍵.json`） |

- 鍵は設定ファイルに書かず、macOS のキーチェーンに入れます（画面に出ません）：`bash scripts/set-secret.sh anthropic-admin`
- 分析（昨日の金額・前 7 日の平均との比較・今月の合計・月末の見込み・予算・初めて使われたモデル）はプログラムが計算し、自宅の AI は説明の文だけを書きます。
- 報告は `data/reports/usage-日付.md`。気をつけることがあれば Mac の通知も出ます。
- 鍵なしで形を試す：`npm run usage -- --demo`（見本の数字）。初回は `npm run usage -- --backfill 31` で過去の分を取ります。
- 毎朝 10:00 に動かす：`bash scripts/schedule-mac.sh 10:00 usage`

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
