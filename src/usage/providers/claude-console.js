// Claude（Anthropic）の予備の方法: Console の「コスト」の画面を ai-browser で読むだけ
// 個人の組織（Individual Org）では Admin API の鍵が作れないため。
// 前もって AIB_PROFILE=claude npm run login -- https://platform.claude.com/login で人がログインしておく。
import { AIBrowser } from '../../browser.js';
import { emptyRecord, mergeRecords } from '../http.js';

// 「9月15日（UTC） $0 $0.03 … $22.13 $22.04 $0.08」の行から、日付と「請求合計」（後ろから 2 つ目）を取る
export function parseCostText(text, now = new Date()) {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const rows = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(/^(\d{1,2})月(\d{1,2})日（UTC）(.*)$/);
    if (m) { if (cur) rows.push(cur); cur = { m: +m[1], d: +m[2], rest: m[3] }; continue; }
    if (cur) cur.rest += ' ' + ln;
  }
  if (cur) rows.push(cur);
  const year = now.getUTCFullYear(), month = now.getUTCMonth() + 1;
  return rows.map((r) => {
    const tokens = r.rest.replace(/[A-Za-z0-9. ]+· \$[\d,.]+/g, ' ').match(/\$[\d,]+(?:\.\d+)?|データなし/g) || [];
    const billed = tokens.length >= 2 ? tokens[tokens.length - 2] : null;
    const y = r.m > month + 1 ? year - 1 : year;
    const date = `${y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}`;
    return { date, costUsd: billed && billed !== 'データなし' ? Number(billed.replace(/[$,]/g, '')) : 0 };
  });
}

export async function collectFromConsole({ cfg = {}, policy, history, from, to }) {
  const b = new AIBrowser({ policy, history, profile: cfg.profile || 'claude' });
  try {
    const o = await b.openUrl(cfg.url || 'https://platform.claude.com/cost');
    if (o.refused) throw new Error(o.reason);
    if (/\/login/.test(b.page.url())) {
      return { records: [], notes: [{ kind: 'login', label: 'Claude Console のログインが切れています', value: `AIB_PROFILE=${cfg.profile || 'claude'} npm run login -- https://platform.claude.com/login` }] };
    }
    await b.page.getByRole('radio', { name: 'テーブル' }).first().waitFor({ timeout: 30000 });
    await b.page.waitForTimeout(3000);
    await b.page.getByRole('radio', { name: 'テーブル' }).first().click(); // グラフを「表」に切り替える（見た目だけの切り替え）
    await b.page.waitForFunction(() => /\d+月\d+日（UTC）/.test(document.body.innerText), null, { timeout: 20000 });
    const text = await b.page.evaluate(() => document.body.innerText);
    const shot = await b.screenshot({ fullPage: true });
    const rows = parseCostText(text).filter((r) => r.date >= from && r.date < to);
    const credit = (text.match(/クレジット\s*\n?\s*(\$[\d,.]+)/) || [])[1];
    const notes = [{ kind: 'screen', label: 'Console のコストの画面から読みました（画像は履歴）', value: shot.file }];
    if (credit) notes.push({ kind: 'info', label: '前払いのクレジットの残り', value: credit });
    return { records: mergeRecords(rows.filter((r) => r.costUsd > 0).map((r) => ({ ...emptyRecord('anthropic', r.date, '(合計・画面)'), costUsd: r.costUsd }))), notes };
  } finally {
    await b.close();
  }
}
