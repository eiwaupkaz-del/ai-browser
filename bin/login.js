#!/usr/bin/env node
// 人が手でログインするための窓を開く（AI はパスワードを入れないため）
//   npm run login -- https://example.com/login
// 窓を閉じると終わり。ログインの状態は data/profile-<名前>/ に残り、AI が同じ状態で使える。
// ※ AI の道具（MCP・Ollama）が動いている間は、同じプロファイルを開けません。
import { chromium } from 'playwright';
import { History } from '../src/history.js';
import { Policy } from '../src/policy.js';
import { profileDir, saveSessionState } from '../src/browser.js';

const url = process.argv[2];
if (!url) { console.error('使い方: npm run login -- <URL>'); process.exit(1); }

const policy = new Policy();
const w = policy.checkWrite(url);
if (!w.ok) console.error(`注意: ${url} は書き込み許可リストにありません。ログインしても AI はこのサイトで入力・送信できません。`);

const history = new History({ client: 'human-login' });
history.write({ kind: 'session', event: 'start', message: '人がログインのために窓を開いた', url });
// handleSIGINT: false … Ctrl-C でも下の片づけ（ログインの印の保存）をしてから終わる
const ctx = await chromium.launchPersistentContext(profileDir(), { headless: false, acceptDownloads: false, locale: 'ja-JP', viewport: null, handleSIGINT: false });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(url);
console.error('ログインが終わったら、窓を閉じてください。');
// Mac では窓を閉じてもブラウザーが終わらないので、最後のタブが閉じたら自分で終わらせる（ここでログインの状態が保存される）
// 「閉じると消える」ログインの印（セッションのクッキー）も残すため、閉じる前に別のファイルへ保存する
let saved = false;
async function finish() {
  if (!saved) {
    saved = true;
    try { await saveSessionState(ctx); } catch (e) { console.error('ログインの印を保存できませんでした:', e.message); }
  }
  await ctx.close().catch(() => {});
}
await new Promise((resolve) => {
  ctx.on('close', resolve);
  const watch = (p) => p.on('close', () => { if (ctx.pages().length === 0) finish(); });
  ctx.pages().forEach(watch);
  ctx.on('page', watch);
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
});
history.write({ kind: 'session', event: 'end', message: 'ログインの窓を閉じた' });
