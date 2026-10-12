#!/usr/bin/env node
// 履歴を見る
//   npm run history                  … 今日の操作（新しい順に 50 件）
//   npm run history -- --date 2026-10-12
//   npm run history -- --days 7 --limit 300
//   npm run history -- --blocked     … 止めた・断ったものだけ
//   npm run history -- --html        … 画像つきの HTML を作って開く
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readHistory, HISTORY_DIR } from '../src/history.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

const onlyBad = flag('--blocked');
const items = readHistory({
  date: opt('--date'),
  days: Number(opt('--days', 1)),
  limit: Number(opt('--limit', 50)),
  filter: onlyBad ? (r) => r.kind === 'blocked' || r.refused || r.blockedCount || r.error : undefined,
});

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function line(r) {
  const t = r.ts.slice(5, 19).replace('T', ' ');
  if (r.kind === 'blocked') return `${t}  [${r.client}] 🛑 止めた通信: ${r.method} ${r.url.slice(0, 100)}\n      ページ: ${r.pageUrl || ''}（${r.reason}）`;
  if (r.kind !== 'tool') return `${t}  [${r.client}] ${r.kind}: ${r.event || r.message || ''}${r.task ? ' 「' + r.task + '」' : ''}`;
  const mark = r.error ? '✖' : r.refused ? '⛔' : '✓';
  let s = `${t}  [${r.client}] ${mark} ${r.tool} ${JSON.stringify(r.args)}`;
  if (r.refused) s += `\n      断った: ${r.refused}`;
  if (r.error) s += `\n      エラー: ${r.error}`;
  if (r.blockedCount) s += `\n      止めた通信 ${r.blockedCount} 件: ${r.blocked.slice(0, 3).map((b) => `${b.method} ${b.url.slice(0, 80)}`).join(' / ')}`;
  if (r.urlAfter && r.urlAfter !== 'about:blank') s += `\n      ${r.urlAfter}`;
  if (r.screenshot) s += `\n      画像: ${r.screenshot}`;
  return s;
}

if (!flag('--html')) {
  if (items.length === 0) console.log('履歴はありません');
  for (const r of items.slice().reverse()) console.log(line(r));
  process.exit(0);
}

const rows = items.slice().reverse().map((r) => {
  const cls = r.error ? 'err' : r.refused || r.blockedCount || r.kind === 'blocked' ? 'stop' : '';
  const shot = r.screenshot && fs.existsSync(r.screenshot) ? `<a href="file://${esc(r.screenshot)}"><img src="file://${esc(r.screenshot)}"></a>` : '';
  return `<tr class="${cls}"><td>${esc(r.ts.slice(0, 19).replace('T', ' '))}</td><td>${esc(r.client)}</td><td>${esc(r.tool || r.kind)}</td>` +
    `<td><code>${esc(r.kind === 'blocked' ? `${r.method} ${r.url}（${r.reason}）` : JSON.stringify(r.args || r.task || r.event || r.message || ''))}</code>` +
    `${r.refused ? `<div>⛔ ${esc(r.refused)}</div>` : ''}${r.error ? `<div>✖ ${esc(r.error)}</div>` : ''}` +
    `${r.blockedCount ? `<div>止めた通信 ${r.blockedCount} 件</div>` : ''}${r.answer ? `<div>答え: ${esc(r.answer)}</div>` : ''}</td>` +
    `<td class="u">${esc(r.urlAfter || '')}</td><td>${shot}</td></tr>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>AI ブラウザーの履歴</title>
<style>body{font:14px system-ui;margin:16px;background:#fff;color:#222}table{border-collapse:collapse;width:100%}
td{border-bottom:1px solid #ddd;padding:6px;vertical-align:top}.u{word-break:break-all;max-width:320px}
tr.stop{background:#fff6e0}tr.err{background:#fde8e8}img{max-width:240px;border:1px solid #ccc}code{white-space:pre-wrap}
@media (prefers-color-scheme:dark){body{background:#1b1b1b;color:#ddd}tr.stop{background:#3a3020}tr.err{background:#3a2020}td{border-color:#333}}</style>
<h1>AI ブラウザーの履歴（${items.length} 件）</h1><table>${rows}</table>`;
const out = path.join(HISTORY_DIR, 'report.html');
fs.writeFileSync(out, html);
console.log(out);
if (process.platform === 'darwin' && !flag('--no-open')) execFileSync('open', [out]);
