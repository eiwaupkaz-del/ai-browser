// Google（Gemini）: Google Cloud の請求データの書き出し（BigQuery）を、読むだけの専用アカウントで読む
//   前もって: 請求先アカウントで「BigQuery への書き出し（標準の使用料金）」を有効にし、
//             サービスアカウント（BigQuery データ閲覧者＋ジョブユーザー）の鍵 JSON を
//             bash scripts/set-secret.sh --file google-sa <鍵.json> でキーチェーンに入れる
//   config: providers.google = { method: "bigquery", projectId, table: "プロジェクト.データセット.gcp_billing_export_v1_XXXX", services: [...] }
// method: "screen" にすると、昔の「画面を読むだけ」（google-browser.js）を使う。
import crypto from 'node:crypto';
import { fetchJson, mergeRecords, emptyRecord } from '../http.js';
import screen from './google-browser.js';

const b64url = (b) => Buffer.from(b).toString('base64url');

// サービスアカウントの鍵で、短い時間だけ使える通行証（アクセストークン）をもらう
export async function googleAccessToken(sa, { scope = 'https://www.googleapis.com/auth/bigquery', fetchImpl = fetch } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetchImpl(tokenUri, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Google の通行証をもらえませんでした ${res.status}（専用アカウントの鍵を確かめてください）`);
  return (await res.json()).access_token;
}

function parseSecret(secret) {
  const text = /^\s*\{/.test(secret) ? secret : Buffer.from(secret, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (!sa.client_email || !sa.private_key) throw new Error('google-sa の中身がサービスアカウントの鍵 JSON ではありません');
  return sa;
}

export default {
  name: 'google',
  label: 'Google（Gemini）',
  secret: 'google-sa',
  browserWhen: (cfg) => cfg.method === 'screen',
  async collect(args) {
    const { from, to, secret, cfg = {}, fetchImpl = fetch } = args;
    if (cfg.method === 'screen') return screen.collect(args);
    if (!cfg.table || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(cfg.table)) throw new Error('config/usage.json の google.table（プロジェクト.データセット.テーブル）がありません');
    const sa = parseSecret(secret);
    const projectId = cfg.projectId || sa.project_id;
    const token = await googleAccessToken(sa, { fetchImpl });
    const services = cfg.services || ['Gemini API', 'Generative Language API'];
    // 金額は「費用＋割引（credits はマイナス）」。円の請求先でも USD に直す（currency_conversion_rate は 1 USD あたりの額）
    const query = `
      SELECT DATE(usage_start_time) AS day, sku.description AS sku,
        SUM(cost + IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) / ANY_VALUE(currency_conversion_rate) AS usd,
        SUM(usage.amount) AS amount, ANY_VALUE(usage.unit) AS unit
      FROM \`${cfg.table}\`
      WHERE service.description IN UNNEST(@services)
        AND usage_start_time >= TIMESTAMP(@from) AND usage_start_time < TIMESTAMP(@to)
      GROUP BY day, sku`;
    let r;
    try {
      r = await fetchJson(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, fetchImpl, timeoutMs: 60000,
      body: {
        query, useLegacySql: false, timeoutMs: 50000, parameterMode: 'NAMED',
        queryParameters: [
          { name: 'services', parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: services.map((value) => ({ value })) } },
          { name: 'from', parameterType: { type: 'STRING' }, parameterValue: { value: from } },
          { name: 'to', parameterType: { type: 'STRING' }, parameterValue: { value: to } },
        ],
      },
      });
    } catch (e) {
      // 書き出しを始めた直後は、表がまだ無い（Google が 1 日ほどで作る）
      if (/ 404/.test(e.message) && /Not found: Table/i.test(e.message)) {
        return { records: [], notes: [{ kind: 'info', label: '請求データの表がまだできていません（書き出しを始めてから 1 日ほどで届きます）' }] };
      }
      throw e;
    }
    if (r.jobComplete === false) throw new Error('BigQuery の集計が時間内に終わりませんでした');
    const names = (r.schema?.fields || []).map((f) => f.name);
    const records = [];
    for (const row of r.rows || []) {
      const v = Object.fromEntries(row.f.map((c, i) => [names[i], c.v]));
      const sku = String(v.sku || '(不明)');
      const amount = Number(v.amount || 0);
      const isToken = /token/i.test(sku) || /token/i.test(String(v.unit || ''));
      records.push({
        ...emptyRecord('google', v.day, sku.replace(/\s+/g, ' ').trim()),
        costUsd: Number(v.usd || 0),
        inputTokens: isToken && /input/i.test(sku) && !/cach/i.test(sku) ? amount : 0,
        cachedTokens: isToken && /cach/i.test(sku) ? amount : 0,
        outputTokens: isToken && /output/i.test(sku) ? amount : 0,
      });
    }
    const notes = [];
    if (!records.length) notes.push({ kind: 'info', label: 'この期間の Gemini の請求データはまだありません（書き出しは 1 日ほど遅れて届きます）' });
    return { records: mergeRecords(records), notes };
  },
};
