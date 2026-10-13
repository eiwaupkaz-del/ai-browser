// xAI（Grok）: 管理用の鍵（Management key・Billing を読むだけ）とチーム ID が必要
//   POST /v1/billing/teams/{team_id}/usage                 … 使った金額（日ごと・説明ごと）
//   GET  /v1/billing/teams/{team_id}/prepaid/balance       … 前払いの残高
// 金額の単位は、初めて本物の鍵で動かしたときに管理画面の数字と見比べて確かめる（config の xai.usdDivisor で直せる）。
import { fetchJson, utcDate, mergeRecords, emptyRecord } from '../http.js';

const BASE = 'https://management-api.x.ai';

export default {
  name: 'xai',
  label: 'xAI（Grok）',
  secret: 'xai-management',
  async collect({ from, to, secret, cfg = {}, fetchImpl }) {
    if (!cfg.teamId) throw new Error('config/usage.json の xai.teamId（チーム ID）がありません');
    const team = encodeURIComponent(cfg.teamId);
    const headers = { authorization: `Bearer ${secret}` };
    const divisor = Number(cfg.usdDivisor || 1);
    const r = await fetchJson(`${BASE}/v1/billing/teams/${team}/usage`, {
      method: 'POST', headers, fetchImpl,
      body: { analyticsRequest: {
        timeRange: { startTime: `${from} 00:00:00`, endTime: `${to} 00:00:00`, timezone: 'Etc/UTC' },
        timeUnit: 'TIME_UNIT_DAY', values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }], groupBy: ['description'], filters: [],
      } },
    });
    const records = [];
    for (const s of r.timeSeries || []) {
      const label = (s.groupLabels && s.groupLabels.join(' ')) || s.group || '(合計)';
      for (const p of s.dataPoints || []) {
        const v = Array.isArray(p.values) ? Number(p.values[0] || 0) : Number(p.values || 0);
        if (!v) continue;
        records.push({ ...emptyRecord('xai', utcDate(p.timestamp), label), costUsd: v / divisor });
      }
    }
    const notes = [];
    try {
      const bal = await fetchJson(`${BASE}/v1/billing/teams/${team}/prepaid/balance`, { headers, fetchImpl });
      // total.val は「セント」で、入金はマイナスで記録される（2026-10 に管理画面の数字と見比べて確かめた）
      if (bal.total && bal.total.val != null) {
        const paid = -Number(bal.total.val) / 100;
        const used = records.reduce((a, x) => a + x.costUsd, 0);
        notes.push({ kind: 'balance', label: '前払いで入金した額の合計', value: paid });
        if (cfg.showRemaining === true) notes.push({ kind: 'info', label: '前払いの残りの目安（入金の合計 − この期間に使った額・画面の数字が正）', value: Math.round((paid - used) * 100) / 100 });
      }
    } catch (e) {
      notes.push({ kind: 'warn', label: '前払いの残高は取れませんでした', value: e.message });
    }
    if (r.limitReached) notes.push({ kind: 'warn', label: '件数の上限に達したので一部だけです' });
    return { records: mergeRecords(records), notes };
  },
};
