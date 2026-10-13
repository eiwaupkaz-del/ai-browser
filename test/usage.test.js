// 使用量の見張り: 各社の返事の読み取りと、計算のテスト（通信はしない・偽の返事を使う）
import test from 'node:test';
import assert from 'node:assert/strict';
import anthropic from '../src/usage/providers/anthropic.js';
import openai from '../src/usage/providers/openai.js';
import xai from '../src/usage/providers/xai.js';
import { analyze } from '../src/usage/analyze.js';
import { buildReport } from '../src/usage/report.js';
import { getSecret } from '../src/usage/secrets.js';

// 道（パス）ごとに返事を決めた偽の fetch。使われた URL と見出しも記録する
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const key = Object.keys(routes).find((k) => u.pathname.endsWith(k));
    if (!key) return new Response('not found', { status: 404 });
    const body = typeof routes[key] === 'function' ? routes[key](u, init) : routes[key];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  f.calls = calls;
  return f;
}

test('Claude: トークンと金額（セント）を日ごと・モデルごとにまとめる・ページを続けて読む', async () => {
  const f = fakeFetch({
    '/usage_report/messages': (u) => u.searchParams.get('page') ? { data: [{ starting_at: '2026-10-11T00:00:00Z', results: [{ model: 'claude-opus-5-5', uncached_input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 1 }] }], has_more: false }
      : { data: [{ starting_at: '2026-10-12T00:00:00Z', results: [{ model: 'claude-opus-5-5', uncached_input_tokens: 1000, cache_read_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 }, output_tokens: 200 }] }], has_more: true, next_page: 'p2' },
    '/cost_report': { data: [{ starting_at: '2026-10-12T00:00:00Z', results: [{ amount: '123.5', currency: 'USD', model: 'claude-opus-5-5', description: 'Claude Opus 5.5 Usage - Input Tokens' }, { amount: '76.5', model: 'claude-opus-5-5' }] }], has_more: false },
  });
  const r = await anthropic.collect({ from: '2026-10-11', to: '2026-10-13', secret: 'sk-ant-admin-test', fetchImpl: f });
  const d12 = r.records.find((x) => x.date === '2026-10-12');
  assert.deepEqual([d12.inputTokens, d12.cachedTokens, d12.outputTokens, d12.costUsd], [1100, 500, 200, 2]);
  assert.ok(r.records.some((x) => x.date === '2026-10-11'));
  const h = f.calls[0].init.headers;
  assert.equal(h['x-api-key'], 'sk-ant-admin-test');
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.match(f.calls[0].url, /group_by%5B%5D=model/);
});

test('OpenAI: キャッシュ分を入力から分け、line_item からモデル名を取る', async () => {
  const f = fakeFetch({
    '/usage/completions': { data: [{ start_time: 1791763200, results: [{ model: 'gpt-4o-mini', input_tokens: 1000, input_cached_tokens: 400, output_tokens: 50, num_model_requests: 7 }] }], has_more: false },
    '/costs': { data: [{ start_time: 1791763200, results: [{ amount: { value: 0.25, currency: 'usd' }, line_item: 'gpt-4o-mini, input' }, { amount: { value: 0.05 }, line_item: 'gpt-4o-mini, output' }] }], has_more: false },
  });
  const r = await openai.collect({ from: '2026-10-12', to: '2026-10-13', secret: 'sk-admin-test', fetchImpl: f });
  assert.equal(r.records.length, 1);
  const x = r.records[0];
  assert.deepEqual([x.date, x.inputTokens, x.cachedTokens, x.outputTokens, x.requests, x.costUsd], ['2026-10-12', 600, 400, 50, 7, 0.3]);
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer sk-admin-test');
});

test('xAI: 日ごとの金額と前払いの残高・チーム ID がないと止まる', async () => {
  const f = fakeFetch({
    '/usage': (u, init) => {
      const body = JSON.parse(init.body).analyticsRequest;
      assert.equal(body.timeUnit, 'TIME_UNIT_DAY');
      return { timeSeries: [{ group: 'grok-4', groupLabels: ['grok-4'], dataPoints: [{ timestamp: '2026-10-12T00:00:00Z', values: [1.5] }, { timestamp: '2026-10-11T00:00:00Z', values: [0] }] }], limitReached: false };
    },
    '/prepaid/balance': { total: { val: 42 }, changes: [] },
  });
  const r = await xai.collect({ from: '2026-10-11', to: '2026-10-13', secret: 'xai-mgmt-test', cfg: { teamId: 'team-1' }, fetchImpl: f });
  assert.deepEqual(r.records.map((x) => [x.date, x.model, x.costUsd]), [['2026-10-12', 'grok-4', 1.5]]);
  assert.equal(r.notes.find((n) => n.kind === 'balance').value, 42);
  assert.match(f.calls[0].url, /\/v1\/billing\/teams\/team-1\/usage$/);
  await assert.rejects(xai.collect({ from: 'x', to: 'y', secret: 's', cfg: {}, fetchImpl: f }), /teamId/);
});

test('鍵が違うときは、わかる言葉でエラーにする（鍵の文字は出さない）', async () => {
  const f = async () => new Response('{"error":"invalid"}', { status: 401 });
  await assert.rejects(openai.collect({ from: '2026-10-12', to: '2026-10-13', secret: 'sk-secret-XYZ', fetchImpl: f }),
    (e) => /権限|鍵/.test(e.message) && !e.message.includes('sk-secret-XYZ'));
});

const rec = (provider, date, costUsd, model = 'm1') => ({ provider, date, model, costUsd, inputTokens: 10, outputTokens: 1, cachedTokens: 0, requests: 1 });

test('分析: 急な増加・予算・月末の見込み・初めてのモデル', () => {
  const records = [];
  for (let d = 1; d <= 9; d++) records.push(rec('openai', `2026-10-0${d}`, 2));
  records.push(rec('openai', '2026-10-10', 9), rec('openai', '2026-10-10', 1, 'new-model'));
  const a = analyze(records, { day: '2026-10-10', providers: ['openai', 'xai'], budgets: { openai: 30 } });
  const o = a.providers[0];
  assert.equal(o.cost, 10);
  assert.equal(o.avg7, 2);
  assert.equal(o.mtd, 28);
  assert.equal(Math.round(o.forecast * 10) / 10, 86.8);
  const kinds = a.alerts.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['budget-warn', 'new-model', 'spike']);
  assert.equal(a.providers[1].hasData, false);
});

test('分析: 前の日が無い会社では「急な増加」も「初めてのモデル」も出さない', () => {
  const a = analyze([rec('xai', '2026-10-10', 50)], { day: '2026-10-10', providers: ['xai'] });
  assert.equal(a.alerts.length, 0);
});

test('報告: 取れなかった会社と円の金額が出る', () => {
  const a = analyze([rec('openai', '2026-10-10', 2)], { day: '2026-10-10', providers: ['openai', 'xai'], usdJpy: 150 });
  const md = buildReport(a, { labels: { openai: 'OpenAI', xai: 'xAI' }, errors: { xai: '鍵が入っていません' } });
  assert.match(md, /xAI \| 取れませんでした/);
  assert.match(md, /約 300 円/);
});

test('鍵は環境変数でも渡せる（テストや他の OS 用）', () => {
  process.env.AIB_SECRET_TEST_KEY = 'abc';
  assert.equal(getSecret('test-key'), 'abc');
  delete process.env.AIB_SECRET_TEST_KEY;
});
