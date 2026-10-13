// Claude（Anthropic）: Admin API の Usage & Cost（管理者用の鍵 sk-ant-admin… が必要）
//   GET /v1/organizations/usage_report/messages … モデルごとのトークン数（日ごと）
//   GET /v1/organizations/cost_report            … 金額（USD の「セント」が文字で来る）
import { fetchJson, utcDate, mergeRecords, emptyRecord } from '../http.js';
import { collectFromConsole } from './claude-console.js';

const BASE = 'https://api.anthropic.com';

async function pages(path, params, key, fetchImpl) {
  const out = [];
  let page;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams(params);
    if (page) q.set('page', page);
    const r = await fetchJson(`${BASE}${path}?${q}`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, fetchImpl });
    out.push(...(r.data || []));
    if (!r.has_more || !r.next_page) break;
    page = r.next_page;
  }
  return out;
}

export default {
  name: 'anthropic',
  label: 'Claude（Anthropic）',
  secret: 'anthropic-admin',
  // method: "console" なら、Admin key を使わず Console の画面を読む（個人の組織用）
  browserWhen: (cfg) => cfg.method === 'console',
  async collect({ from, to, secret, fetchImpl, cfg = {}, policy, history }) {
    if (cfg.method === 'console') return collectFromConsole({ cfg, policy, history, from, to });
    const range = [['starting_at', `${from}T00:00:00Z`], ['ending_at', `${to}T00:00:00Z`], ['bucket_width', '1d'], ['limit', '31']];
    const usage = await pages('/v1/organizations/usage_report/messages', [...range, ['group_by[]', 'model']], secret, fetchImpl);
    const cost = await pages('/v1/organizations/cost_report', [...range.filter(([k]) => k !== 'bucket_width' && k !== 'limit'), ['group_by[]', 'description']], secret, fetchImpl);
    const records = [];
    for (const b of usage) {
      const date = utcDate(b.starting_at);
      for (const r of b.results || []) {
        const c = r.cache_creation || {};
        records.push({
          ...emptyRecord('anthropic', date, r.model || '(不明)'),
          inputTokens: (r.uncached_input_tokens || 0) + (c.ephemeral_5m_input_tokens || 0) + (c.ephemeral_1h_input_tokens || 0),
          cachedTokens: r.cache_read_input_tokens || 0,
          outputTokens: r.output_tokens || 0,
        });
      }
    }
    for (const b of cost) {
      const date = utcDate(b.starting_at);
      for (const r of b.results || []) {
        records.push({ ...emptyRecord('anthropic', date, r.model || r.description || '(その他)'), costUsd: Number(r.amount || 0) / 100 });
      }
    }
    return { records: mergeRecords(records), notes: [] };
  },
};
