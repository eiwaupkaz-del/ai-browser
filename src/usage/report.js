// 報告の文（MarkDown）を作る
const usd = (v) => (v == null ? '—' : `$${v.toFixed(2)}`);
const jpy = (v, r) => (v == null ? '' : `（約 ${Math.round(v * r).toLocaleString('ja-JP')} 円）`);
const tok = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v));

export function buildReport(a, { labels, notes = {}, comment, errors = {}, demo = false }) {
  const L = [];
  L.push(`# AI の API 使用量（${a.day}・世界標準時の 1 日）`);
  if (demo) L.push('', '> ⚠️ これは見本の数字です（本物の使用量ではありません）。');
  L.push('', a.alerts.length ? '## ⚠️ 気をつけること' : '## ✓ 気になる動きはありません');
  for (const x of a.alerts) L.push(`- ${labels[x.provider] || '合計'}: ${x.text}`);
  if (comment) L.push('', '## 自宅の AI のひとこと', '', comment);
  L.push('', '## 会社ごと', '', '| 会社 | 昨日 | 前 7 日の平均 | 今月の合計 | 月末の見込み | 予算 |', '|---|---|---|---|---|---|');
  for (const p of a.providers) {
    const name = labels[p.provider];
    if (errors[p.provider]) { L.push(`| ${name} | 取れませんでした | | | | |`); continue; }
    if (!p.hasData) { L.push(`| ${name} | （金額の記録なし） | | | | |`); continue; }
    L.push(`| ${name} | ${usd(p.cost)} | ${usd(p.avg7)} | ${usd(p.mtd)} | ${usd(p.forecast)} | ${p.budget ? usd(p.budget) : '—'} |`);
  }
  L.push(`| **合計** | **${usd(a.total.cost)}**${jpy(a.total.cost, a.usdJpy)} | | **${usd(a.total.mtd)}** | **${usd(a.total.forecast)}**${jpy(a.total.forecast, a.usdJpy)} | ${a.total.budget ? usd(a.total.budget) : '—'} |`);
  for (const p of a.providers) {
    const extra = notes[p.provider] || [];
    if (!p.models.length && !extra.length && !errors[p.provider]) continue;
    L.push('', `### ${labels[p.provider]}`);
    if (errors[p.provider]) L.push(`- ✖ ${errors[p.provider]}`);
    for (const m of p.models.slice(0, 8)) {
      const parts = [usd(m.costUsd)];
      if (m.inputTokens || m.outputTokens) parts.push(`入力 ${tok(m.inputTokens)}・出力 ${tok(m.outputTokens)}${m.cachedTokens ? `・キャッシュ ${tok(m.cachedTokens)}` : ''}`);
      if (m.requests) parts.push(`${m.requests.toLocaleString('ja-JP')} 回`);
      L.push(`- ${m.model}: ${parts.join('・')}`);
    }
    for (const n of extra) L.push(`- ${n.label}${n.value != null ? `: ${typeof n.value === 'number' ? usd(n.value) : n.value}` : ''}`);
  }
  L.push('', `為替: 1 ドル = ${a.usdJpy} 円で計算。各社の数字は数時間〜1 日遅れて確定することがあります。`);
  return L.join('\n') + '\n';
}
