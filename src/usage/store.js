// 使用量の保存: data/usage/<日付>.json に「会社ごと」の記録を置く（取り直すと、その会社の分だけ入れ替える）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const USAGE_DIR = process.env.AIB_USAGE_DIR || path.join(ROOT, 'data', 'usage');

export function saveRecords(provider, records, { dir = USAGE_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const byDate = new Map();
  for (const r of records) byDate.set(r.date, [...(byDate.get(r.date) || []), r]);
  for (const [date, list] of byDate) {
    const f = path.join(dir, `${date}.json`);
    const day = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    day[provider] = list;
    fs.writeFileSync(f, JSON.stringify(day, null, 1));
  }
}

export function loadRecords({ dir = USAGE_DIR, from, to } = {}) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
    const date = f.slice(0, 10);
    if ((from && date < from) || (to && date > to)) continue;
    for (const list of Object.values(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))) out.push(...list);
  }
  return out;
}
