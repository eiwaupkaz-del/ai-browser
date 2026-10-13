#!/usr/bin/env node
// CP2P のルームに投稿する
//   node bin/cp2p-post.js --room ありがとうOC --subject "件名" --file 本文.md [--dry-run]
//   --dry-run は送信の直前まで進めて画面の画像を撮り、送らずに閉じる
// ログインの入れ物（プロファイル）は AIB_PROFILE（既定 cp2p）。
import fs from 'node:fs';
import { Policy } from '../src/policy.js';
import { History } from '../src/history.js';
import { AIBrowser } from '../src/browser.js';
import { postToCp2pRoom, toPlainText } from '../src/posters/cp2p.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const room = opt('--room');
const dmTo = opt('--dm');
const attach = opt('--attach');
const file = opt('--file');
const text = file ? fs.readFileSync(file, 'utf8') : opt('--text');
if ((!room && !dmTo) || !text) {
  console.error('使い方: node bin/cp2p-post.js (--room <ルーム名> | --dm <友達の名前>) (--file <ファイル> | --text <文>) [--subject <件名>] [--attach <data/の中のファイル>] [--dry-run]');
  process.exit(1);
}

const history = new History({ client: 'cp2p-post' });
const browser = new AIBrowser({ policy: new Policy(), history, profile: process.env.AIB_PROFILE || 'cp2p' });
try {
  const r = await postToCp2pRoom(browser, {
    url: opt('--url', 'https://cp2p.eiwa-up.jp/'), room, dmTo, attach, subject: opt('--subject'),
    body: file && file.endsWith('.md') ? toPlainText(text) : text, dryRun: argv.includes('--dry-run'),
  });
  history.write({ kind: 'note', message: r.sent ? 'CP2P に投稿した' : 'CP2P への投稿を試した（送らず）', room: room || `DM:${dmTo}`, file });
  console.log(JSON.stringify(r));
} catch (e) {
  history.write({ kind: 'note', message: 'CP2P への投稿に失敗', room, error: e.message });
  console.error('エラー:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
