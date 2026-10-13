// 分析: 数字の計算はすべてここ（AI には計算させない）
import { addDays } from './http.js';

const sum = (xs, f) => xs.reduce((a, r) => a + Number(r[f] || 0), 0);

export function analyze(records, { day, providers, budgets = {}, spikeRatio = 2, spikeMinUsd = 1, budgetWarn = 0.8, usdJpy = 150 }) {
  const monthStart = day.slice(0, 8) + '01';
  const dayOfMonth = Number(day.slice(8, 10));
  const [y, m] = day.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prev7 = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)));
  const prev30From = addDays(day, -30);

  const result = { day, usdJpy, providers: [], alerts: [], total: null };
  for (const p of providers) {
    const mine = records.filter((r) => r.provider === p);
    const today = mine.filter((r) => r.date === day);
    const daysWithData = new Set(mine.filter((r) => prev7.includes(r.date)).map((r) => r.date));
    const avg7 = daysWithData.size ? sum(mine.filter((r) => prev7.includes(r.date)), 'costUsd') / 7 : null;
    const mtd = sum(mine.filter((r) => r.date >= monthStart && r.date <= day), 'costUsd');
    const forecast = mtd / dayOfMonth * daysInMonth;
    const cost = sum(today, 'costUsd');
    const models = new Map();
    for (const r of today) {
      const x = models.get(r.model) || { model: r.model, costUsd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 };
      for (const f of ['costUsd', 'inputTokens', 'outputTokens', 'cachedTokens', 'requests']) x[f] += Number(r[f] || 0);
      models.set(r.model, x);
    }
    const seenBefore = new Set(mine.filter((r) => r.date >= prev30From && r.date < day).map((r) => r.model));
    const newModels = [...models.keys()].filter((mm) => mine.some((r) => r.date < day) && !seenBefore.has(mm));
    const row = {
      provider: p, cost, avg7, mtd, forecast, budget: budgets[p] ?? null,
      inputTokens: sum(today, 'inputTokens'), outputTokens: sum(today, 'outputTokens'), cachedTokens: sum(today, 'cachedTokens'), requests: sum(today, 'requests'),
      models: [...models.values()].sort((a, b) => b.costUsd - a.costUsd), newModels, hasData: mine.length > 0,
    };
    result.providers.push(row);
    if (avg7 != null && cost >= spikeMinUsd && cost > avg7 * spikeRatio) {
      result.alerts.push({ provider: p, kind: 'spike', text: `昨日の金額 $${cost.toFixed(2)} が、前の 7 日の平均 $${avg7.toFixed(2)} の ${(cost / Math.max(avg7, 0.01)).toFixed(1)} 倍` });
    }
    if (row.budget) {
      if (mtd >= row.budget) result.alerts.push({ provider: p, kind: 'budget-over', text: `今月の合計 $${mtd.toFixed(2)} が予算 $${row.budget} を超えました` });
      else if (mtd >= row.budget * budgetWarn) result.alerts.push({ provider: p, kind: 'budget-warn', text: `今月の合計 $${mtd.toFixed(2)} が予算 $${row.budget} の ${Math.round(mtd / row.budget * 100)}%` });
      else if (forecast > row.budget) result.alerts.push({ provider: p, kind: 'budget-forecast', text: `このままだと月末に $${forecast.toFixed(2)} になり、予算 $${row.budget} を超える見込み` });
    }
    for (const nm of newModels) result.alerts.push({ provider: p, kind: 'new-model', text: `初めて使われたモデル: ${nm}` });
  }
  const t = result.providers;
  result.total = { cost: sum(t, 'cost'), mtd: sum(t, 'mtd'), forecast: sum(t, 'forecast'), budget: budgets.total ?? null };
  if (result.total.budget && result.total.forecast > result.total.budget) {
    result.alerts.push({ provider: 'total', kind: 'budget-forecast', text: `4 社の合計が月末に $${result.total.forecast.toFixed(2)} になり、全体の予算 $${result.total.budget} を超える見込み` });
  }
  return result;
}
