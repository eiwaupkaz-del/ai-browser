#!/usr/bin/env node
// AI の API 使用量を集めて分析する
//   npm run usage                     … 昨日（UTC）の分を集めて報告（直近 3 日は取り直す）
//   npm run usage -- --backfill 31    … 初回: 過去 31 日分をまとめて取る
//   npm run usage -- --demo           … 鍵なしで、見本の数字で報告の形を試す
//   npm run usage -- --day 2026-10-12 … 日を決めて報告
// 会社と予算は config/usage.json（なければ見本 config/usage.example.json）。
// 鍵はキーチェーンに入れる: bash scripts/set-secret.sh anthropic-admin
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DEMO = argv.includes('--demo');
if (DEMO) process.env.AIB_USAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-usage-demo-'));

const { Policy } = await import('../src/policy.js');
const { History } = await import('../src/history.js');
const { loadLocalConfig } = await import('../src/ollama-agent.js');
const { getSecret } = await import('../src/usage/secrets.js');
const { addDays, utcDate } = await import('../src/usage/http.js');
const { saveRecords, loadRecords } = await import('../src/usage/store.js');
const { analyze } = await import('../src/usage/analyze.js');
const { buildReport } = await import('../src/usage/report.js');
const { buildChartSvg, renderChartPng } = await import('../src/usage/chart.js');
const { AIBrowser } = await import('../src/browser.js');
const { postToCp2pRoom, toPlainText } = await import('../src/posters/cp2p.js');
const PROVIDERS = Object.fromEntries((await Promise.all(['anthropic', 'openai', 'xai', 'google']
  .map((n) => import(`../src/usage/providers/${n}.js`)))).map((m) => [m.default.name, m.default]));

const cfgFile = fs.existsSync(path.join(ROOT, 'config', 'usage.json'))
  ? path.join(ROOT, 'config', 'usage.json') : path.join(ROOT, 'config', 'usage.example.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const enabled = Object.keys(PROVIDERS).filter((p) => cfg.providers?.[p]?.enabled !== false);
const day = opt('--day', addDays(utcDate(Date.now()), -1));
const back = Number(opt('--backfill', cfg.refetchDays || 3));
const from = addDays(day, -(back - 1));
const to = addDays(day, 1); // 終わりは含まない

const history = new History({ client: DEMO ? 'usage-demo' : 'usage' });
history.write({ kind: 'session', event: 'start', message: 'API 使用量の見張り', day, from, providers: enabled, demo: DEMO || undefined });

// 見本の数字（鍵なしで形を試す用・本物ではない）
function demoRecords(p) {
  const base = { anthropic: 3.2, openai: 1.8, xai: 0.6, google: 0.9 }[p];
  if (!base) return [];
  const models = { anthropic: ['claude-opus-5-5', 'claude-haiku-5-5'], openai: ['gpt-image-1', 'gpt-4o-mini'], xai: ['grok-4'], google: ['Gemini 2.5 Flash input token count', 'Gemini 2.5 Flash output token count'] }[p];
  const out = [];
  for (let i = 40; i >= 1; i--) {
    const date = addDays(day, -i + 1);
    models.forEach((m, j) => {
      const wave = 1 + 0.25 * Math.sin(i + j);
      const spike = p === 'anthropic' && date === day && j === 0 ? 3.5 : 1;
      const cost = (base / (j + 1)) * wave * spike;
      out.push({ provider: p, date, model: m, costUsd: Math.round(cost * 100) / 100, inputTokens: Math.round(cost * 180000), outputTokens: Math.round(cost * 24000), cachedTokens: Math.round(cost * 90000), requests: Math.round(cost * 40) });
    });
  }
  return out;
}

const notes = {};
const errors = {};
const policy = new Policy();
for (const p of enabled) {
  const prov = PROVIDERS[p];
  const pcfg = cfg.providers?.[p] || {};
  try {
    if (DEMO) {
      saveRecords(p, demoRecords(p));
      
      continue;
    }
    let secret;
    const usesBrowser = prov.browser || (prov.browserWhen && prov.browserWhen(pcfg));
    if (!usesBrowser) {
      secret = getSecret(prov.secret);
      if (!secret) { errors[p] = `鍵が入っていません（bash scripts/set-secret.sh ${prov.secret}）`; continue; }
    }
    const r = await prov.collect({ from, to, secret, cfg: pcfg, policy, history });
    saveRecords(p, r.records);
    notes[p] = r.notes || [];
    history.write({ kind: 'note', message: '使用量を取った', provider: p, records: r.records.length, notes: r.notes, raw: r.raw });
  } catch (e) {
    errors[p] = e.message.split('\n')[0];
    history.write({ kind: 'note', message: '使用量を取れなかった', provider: p, error: errors[p] });
  }
}

const records = loadRecords({ from: addDays(day, -45), to: day });
const a = analyze(records, {
  day, providers: enabled, budgets: cfg.budgetsUsd || {}, usdJpy: cfg.usdJpy || 150,
  spikeRatio: cfg.alerts?.spikeRatio || 2, spikeMinUsd: cfg.alerts?.spikeMinUsd ?? 1, budgetWarn: cfg.alerts?.budgetWarn || 0.8,
});
const labels = Object.fromEntries(enabled.map((p) => [p, PROVIDERS[p].label]));

// 自宅の AI に短い説明を書いてもらう（数字は渡すだけ。新しい数字は作らせない）
let comment = '';
// 1 社も数字が取れていない日は書かない（「ゼロ」と誤解されるため）
if (cfg.aiComment !== false && a.providers.some((p) => p.hasData && !errors[p.provider])) {
  try {
    const llm = loadLocalConfig();
    const facts = { 日: a.day, 気をつけること: a.alerts.map((x) => `${labels[x.provider] || '合計'}: ${x.text}`),
      会社ごと: a.providers.map((p) => ({ 会社: labels[p.provider], 昨日の金額: +p.cost.toFixed(2), 前7日の平均: p.avg7 == null ? null : +p.avg7.toFixed(2), 今月: +p.mtd.toFixed(2), 月末の見込み: +p.forecast.toFixed(2), 一番使ったモデル: p.models[0]?.model })),
      取れなかった会社: Object.keys(errors).map((p) => labels[p]) };
    const res = await fetch(`${llm.ollamaUrl}/api/chat`, {
      method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: llm.model, stream: false, think: false, messages: [{ role: 'user', content:
        `次は AI の API の使用量を集計した結果です（金額はドル）。持ち主に向けて、気をつけることを先に、やさしい日本語で 2〜4 行の箇条書き（「・」で始める）で説明してください。下にない数字は書かないでください。\n\n${JSON.stringify(facts, null, 1)}` }] }),
    });
    if (res.ok) comment = (await res.json()).message.content.trim();
  } catch {}
}

const report = buildReport(a, { labels, notes, comment, errors, demo: DEMO });
const outDir = path.join(ROOT, 'data', 'reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `usage-${day}${DEMO ? '-demo' : ''}.md`);
fs.writeFileSync(out, report);
// 日ごとのグラフの画像（直近 30 日）
let chartFile = '';
try {
  const svg = buildChartSvg(loadRecords({ from: addDays(day, -29), to: day }), { day, providers: enabled, labels, usdJpy: cfg.usdJpy || 150 });
  chartFile = await renderChartPng(svg, path.join(outDir, `usage-${day}${DEMO ? '-demo' : ''}.png`));
} catch (e) {
  history.write({ kind: 'note', message: 'グラフの画像を作れなかった', error: e.message });
}

// 届ける（config の post。CP2P のルームか DM）
let posted = '';
if (!DEMO && cfg.post && cfg.post.type === 'cp2p' && !argv.includes('--no-post')) {
  const poster = new AIBrowser({ policy, history, profile: cfg.post.profile || 'cp2p' });
  const where = cfg.post.dmTo ? `${cfg.post.dmTo} さんへの DM` : `「${cfg.post.room}」`;
  try {
    const r = await postToCp2pRoom(poster, {
      url: cfg.post.url, room: cfg.post.room, dmTo: cfg.post.dmTo, attach: chartFile || undefined, relay: !!cfg.post.relay,
      dryRun: argv.includes('--dry-run-post'),
      subject: `💰 AI の API 使用量（${day.slice(5).replace('-', '/')}・昨日 $${a.total.cost.toFixed(2)}・今月 $${a.total.mtd.toFixed(2)}）`,
      body: toPlainText(report),
    });
    posted = r.sent ? `CP2P の${where}に送りました` : `CP2P の${where}への送信を試しました（送らず）`;
  } catch (e) {
    posted = `CP2P の${where}への送信に失敗: ${e.message}`;
  } finally {
    await poster.close();
  }
  history.write({ kind: 'note', message: posted });
  console.error(posted);
}
history.write({ kind: 'session', event: 'end', message: 'API 使用量の報告', report: out, chart: chartFile, posted, alerts: a.alerts.length, errors: Object.keys(errors) });
console.log(report);
console.error(`保存: ${out}`);

const needsAttention = a.alerts.length || Object.keys(errors).length || /失敗/.test(posted);
if (process.platform === 'darwin' && cfg.notify !== false && (needsAttention || cfg.notifyAlways)) {
  const msg = a.alerts.length ? `気をつけること ${a.alerts.length} 件` : `取れなかった会社 ${Object.keys(errors).length} 件`;
  try { execFileSync('osascript', ['-e', `display notification "${msg}（昨日 $${a.total.cost.toFixed(2)}）" with title "AI の API 使用量${DEMO ? '（見本）' : ''}"`]); } catch {}
}
if (DEMO) fs.rmSync(process.env.AIB_USAGE_DIR, { recursive: true, force: true });
