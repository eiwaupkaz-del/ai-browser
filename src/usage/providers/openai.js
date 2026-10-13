// OpenAI: 管理者用の鍵（Admin key）が必要
//   GET /v1/organization/usage/completions … モデルごとのトークン数と回数（日ごと）
//   GET /v1/organization/costs             … 金額（USD）。line_item は「モデル名, input」のような形
import { fetchJson, utcDate, mergeRecords, emptyRecord } from '../http.js';

const BASE = 'https://api.openai.com';

async function pages(path, params, key, fetchImpl) {
  const out = [];
  let page;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams(params);
    if (page) q.set('page', page);
    const r = await fetchJson(`${BASE}${path}?${q}`, { headers: { authorization: `Bearer ${key}` }, fetchImpl });
    out.push(...(r.data || []));
    if (!r.has_more || !r.next_page) break;
    page = r.next_page;
  }
  return out;
}

export default {
  name: 'openai',
  label: 'OpenAI',
  secret: 'openai-admin',
  async collect({ from, to, secret, fetchImpl }) {
    const unix = (d) => String(Date.parse(`${d}T00:00:00Z`) / 1000);
    const range = [['start_time', unix(from)], ['end_time', unix(to)], ['bucket_width', '1d'], ['limit', '31']];
    const usage = await pages('/v1/organization/usage/completions', [...range, ['group_by', 'model']], secret, fetchImpl);
    const cost = await pages('/v1/organization/costs', [...range, ['group_by', 'line_item']], secret, fetchImpl);
    const records = [];
    for (const b of usage) {
      const date = utcDate(b.start_time * 1000);
      for (const r of b.results || []) {
        records.push({
          ...emptyRecord('openai', date, r.model || '(不明)'),
          inputTokens: (r.input_tokens || 0) - (r.input_cached_tokens || 0),
          cachedTokens: r.input_cached_tokens || 0,
          outputTokens: r.output_tokens || 0,
          requests: r.num_model_requests || 0,
        });
      }
    }
    for (const b of cost) {
      const date = utcDate(b.start_time * 1000);
      for (const r of b.results || []) {
        const model = String(r.line_item || '(その他)').split(',')[0].trim();
        records.push({ ...emptyRecord('openai', date, model), costUsd: Number(r.amount && r.amount.value || 0) });
      }
    }
    return { records: mergeRecords(records), notes: [] };
  },
};
