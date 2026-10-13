// 使用量の日ごとの積み上げ棒グラフを PNG にする（外の通信はしない・SVG を Chromium で画像にするだけ）
import { chromium } from 'playwright';
import { addDays } from './http.js';

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']; // 決まった順（会社の順に固定）
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildChartSvg(records, { day, days = 30, providers, labels, usdJpy = 150 }) {
  const dates = Array.from({ length: days }, (_, i) => addDays(day, i - days + 1));
  const per = dates.map((d) => providers.map((p) => records.filter((r) => r.provider === p && r.date === d).reduce((a, r) => a + r.costUsd, 0)));
  const totals = per.map((v) => v.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const step = max > 40 ? 10 : max > 20 ? 5 : max > 8 ? 2 : 1;
  const top = Math.ceil(max / step) * step;
  const W = 1000, H = 520, L = 56, R = 20, T = 70, B = 60;
  const pw = W - L - R, ph = H - T - B, bw = pw / days;
  const y = (v) => T + ph - (v / top) * ph;
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e1e0d9"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="13" fill="#898781">$${v}</text>`;
  let bars = '';
  per.forEach((vals, i) => {
    let acc = 0;
    const x = L + i * bw + bw * 0.18, w = Math.min(22, bw * 0.64);
    vals.forEach((v, j) => {
      if (v <= 0) return;
      const y1 = y(acc + v), y0 = y(acc);
      bars += `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(0, y0 - y1 - (acc > 0 ? 0 : 0))}" fill="${COLORS[j]}" stroke="#fcfcfb" stroke-width="1"/>`;
      acc += v;
    });
    if ((days - 1 - i) % 5 === 0) bars += `<text x="${x + w / 2}" y="${H - B + 20}" text-anchor="middle" font-size="13" fill="#898781">${dates[i].slice(5).replace('-', '/').replace(/^0/, '')}</text>`;
  });
  const sum = providers.map((p, j) => per.reduce((a, v) => a + v[j], 0));
  const total = sum.reduce((a, b) => a + b, 0);
  let legend = '';
  let lx = L;
  providers.forEach((p, j) => {
    const t = `${labels[p] || p} $${sum[j].toFixed(2)}`;
    legend += `<rect x="${lx}" y="44" width="12" height="12" rx="2" fill="${COLORS[j]}"/><text x="${lx + 18}" y="55" font-size="14" fill="#52514e">${esc(t)}</text>`;
    lx += 40 + t.length * 9.2;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, 'Hiragino Sans', sans-serif">
<rect width="${W}" height="${H}" fill="#fcfcfb"/>
<text x="${L}" y="28" font-size="20" fill="#0b0b0b">AI の API 使用額（日ごと・${dates[0].slice(5).replace('-', '/')}〜${day.slice(5).replace('-', '/')}）　合計 $${total.toFixed(2)}（約 ${Math.round(total * usdJpy).toLocaleString('ja-JP')} 円）</text>
${legend}${g}${bars}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#c3c2b7"/>
<text x="${W - R}" y="${H - 10}" text-anchor="end" font-size="12" fill="#898781">ドル。日付は各社の集計の日（Claude・OpenAI・xAI は世界標準時）</text>
</svg>`;
}

export async function renderChartPng(svg, file) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 520 }, deviceScaleFactor: 2 });
    await page.route('**/*', (r) => r.abort()); // 外へは一切つながない
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: file });
  } finally {
    await browser.close();
  }
  return file;
}
