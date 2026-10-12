// 決まり（policy）: どの URL を開いてよいか・どこで書き込みをしてよいか
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 各自の config/policy.json があればそれを、なければ見本（policy.example.json）を使う
export const DEFAULT_POLICY_FILE = process.env.AIB_POLICY ||
  (fs.existsSync(path.join(ROOT, 'config', 'policy.json'))
    ? path.join(ROOT, 'config', 'policy.json')
    : path.join(ROOT, 'config', 'policy.example.json'));

// pattern の * を「何でも」として正規表現にする
export function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$', 'i');
}

function isPrivateIp(host) {
  const h = host.replace(/^\[|\]$/g, '');
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127); // Tailscale などの宛先
  }
  if (h.includes(':')) return h === '::1' || /^f[cd]/i.test(h) || /^fe80/i.test(h);
  return /\.local$/i.test(h) || /\.localhost$/i.test(h);
}

export class Policy {
  constructor(file = DEFAULT_POLICY_FILE) {
    this.file = file;
    this.mtime = 0;
    this.data = null;
    this.reload();
  }

  // ファイルが書き換えられたら読み直す（再起動しなくても新しいリストが効く）
  reload() {
    const stat = fs.statSync(this.file);
    if (stat.mtimeMs === this.mtime && this.data) return;
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    data.writeAllowlist = (data.writeAllowlist || []).map((e) =>
      typeof e === 'string' ? { pattern: e, note: '' } : e);
    data._regexps = data.writeAllowlist.map((e) => patternToRegExp(e.pattern));
    this.data = data;
    this.mtime = stat.mtimeMs;
  }

  get settings() { this.reload(); return this.data; }

  // 開いてよい URL か（閲覧の決まり）
  checkBrowse(url) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, reason: 'URL の形が正しくありません' }; }
    if (!['http:', 'https:'].includes(u.protocol) && url !== 'about:blank') {
      return { ok: false, reason: `${u.protocol} は開けません（http と https だけ）` };
    }
    if (url === 'about:blank') return { ok: true };
    const s = this.settings;
    const host = u.hostname.toLowerCase();
    if ((s.blockedHosts || []).map((h) => h.toLowerCase().replace(/^\[|\]$/g, '')).includes(host.replace(/^\[|\]$/g, ''))) {
      return { ok: false, reason: `${host} は止めている宛先です` };
    }
    if (s.blockPrivateNetwork !== false && isPrivateIp(host)) {
      return { ok: false, reason: `${host} は自宅・社内のネットワークの宛先なので開けません` };
    }
    return { ok: true };
  }

  // 書き込み・送信をしてよい URL か
  checkWrite(url) {
    const s = this.settings;
    let clean = url;
    try { const u = new URL(url); u.hash = ''; clean = u.toString(); } catch { return { ok: false, reason: 'URL の形が正しくありません' }; }
    const browse = this.checkBrowse(clean);
    if (!browse.ok) return browse;
    const i = s._regexps.findIndex((re) => re.test(clean));
    if (i >= 0) return { ok: true, rule: s.writeAllowlist[i].pattern };
    return { ok: false, reason: '書き込み許可リストにない URL です（閲覧だけできます）' };
  }

  listWriteAllowlist() {
    return this.settings.writeAllowlist.map(({ pattern, note }) => ({ pattern, note }));
  }
}
