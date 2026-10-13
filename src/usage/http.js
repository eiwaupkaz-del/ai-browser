// 鍵を使う通信。鍵は履歴やエラーの文に出さない。
export async function fetchJson(url, { method = 'GET', headers = {}, body, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const res = await fetchImpl(url, {
    method, headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? '（鍵が違うか、権限が足りません）' : '';
    throw new Error(`${new URL(url).host} の返事がエラー ${res.status}${hint}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

// UTC の日付（YYYY-MM-DD）。各社とも 1 日の区切りは UTC。
export const utcDate = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (date, n) => utcDate(Date.parse(date + 'T00:00:00Z') + n * 86400000);

export function emptyRecord(provider, date, model) {
  return { provider, date, model, inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, costUsd: 0 };
}

// 同じ「会社・日付・モデル」の記録を足し合わせる
export function mergeRecords(records) {
  const map = new Map();
  for (const r of records) {
    const k = `${r.provider}|${r.date}|${r.model}`;
    const m = map.get(k) || emptyRecord(r.provider, r.date, r.model);
    for (const f of ['inputTokens', 'outputTokens', 'cachedTokens', 'requests', 'costUsd']) m[f] += Number(r[f] || 0);
    map.set(k, m);
  }
  return [...map.values()].map((r) => ({ ...r, costUsd: Math.round(r.costUsd * 1e6) / 1e6 }));
}
