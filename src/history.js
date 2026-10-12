// 履歴: すべての操作を 1 行 1 件の JSON（JSONL）で日付ごとのファイルに追記する。
// 消したり書き換えたりはしない（追記だけ）。あとで bin/history.js で見られる。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORY_DIR = process.env.AIB_HISTORY_DIR || path.join(ROOT, 'data', 'history');

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localStamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${localDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

export class History {
  constructor({ client = 'unknown', dir = HISTORY_DIR } = {}) {
    this.dir = dir;
    this.client = client;
    this.session = `${localDate().replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
    this.seq = 0;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(date = localDate()) { return path.join(this.dir, `${date}.jsonl`); }

  shotPath() {
    const d = path.join(this.dir, localDate(), 'shots');
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, `${this.session}-${String(this.seq).padStart(4, '0')}-${Date.now()}.png`);
  }

  // kind: tool（道具の呼び出し）/ blocked（止めた通信）/ session（開始・終了）/ note
  write(entry) {
    this.seq += 1;
    const rec = { ts: localStamp(), session: this.session, seq: this.seq, client: this.client, ...entry };
    fs.appendFileSync(this.file(), JSON.stringify(rec) + '\n');
    return rec;
  }
}

// 履歴を読む（新しい順に limit 件）
export function readHistory({ dir = HISTORY_DIR, date, days = 1, limit = 50, filter } = {}) {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse()
    : [];
  const picked = date ? files.filter((f) => f.startsWith(date)) : files.slice(0, days);
  const out = [];
  for (const f of picked) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      if (filter && !filter(rec)) continue;
      out.push(rec);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
