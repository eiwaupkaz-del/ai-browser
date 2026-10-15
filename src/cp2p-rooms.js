// CP2P のルームを読む・書く入口（コマンド npm run cp2p と MCP の道具の両方で使う）
// - 使えるのは config/cp2p.json の rooms に書いたルームだけ（なければ見本 config/cp2p.example.json）
// - 書くのは同じルームへ postMinIntervalMin 分に 1 回まで（ほかの人がいるルームなので控えめに）
// - ログインは profile（既定 cp2p）。人が前もって npm run login で入り、各ルームの参加キーを CP2P に保存しておく
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Policy } from './policy.js';
import { AIBrowser } from './browser.js';
import { readCp2pRoom, postToCp2pRoom } from './posters/cp2p.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POST_LOG = path.join(ROOT, 'data', 'cp2p-posts.json');

export function loadCp2pConfig() {
  const own = path.join(ROOT, 'config', 'cp2p.json');
  const file = fs.existsSync(own) ? own : path.join(ROOT, 'config', 'cp2p.example.json');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { url: c.url || 'https://cp2p.eiwa-up.jp/', profile: c.profile || 'cp2p', rooms: c.rooms || [], postMinIntervalMin: c.postMinIntervalMin ?? 10, file };
}

function checkRoom(cfg, room) {
  const r = String(room || '').trim().replace(/^#/, '');
  if (!r) throw new Error('ルーム名がありません');
  if (!cfg.rooms.includes(r)) throw new Error(`「${r}」は使えるルームではありません（使えるのは ${cfg.rooms.join('・')}）`);
  return r;
}

function readPostLog() { try { return JSON.parse(fs.readFileSync(POST_LOG, 'utf8')); } catch { return {}; } }

async function withBrowser(cfg, history, fn) {
  const b = new AIBrowser({ policy: new Policy(), history, profile: cfg.profile });
  try { return await fn(b); } finally { await b.close(); }
}

export async function cp2pRead(history, { room, hours = 24, limit = 30 }) {
  const cfg = loadCp2pConfig();
  const r = checkRoom(cfg, room);
  hours = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 168);
  limit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  return withBrowser(cfg, history, (b) => readCp2pRoom(b, { url: cfg.url, room: r, hours, limit }));
}

export async function cp2pPost(history, { room, subject, body, dryRun = false }) {
  const cfg = loadCp2pConfig();
  const r = checkRoom(cfg, room);
  if (!String(body || '').trim()) throw new Error('本文がありません');
  const log = readPostLog();
  const last = log[r] || 0;
  const waitMin = Math.ceil((last + cfg.postMinIntervalMin * 60000 - Date.now()) / 60000);
  if (!dryRun && waitMin > 0) throw new Error(`「${r}」には少し前に投稿しました。あと ${waitMin} 分あけてください（ほかの人がいるルームなので控えめに）`);
  const res = await withBrowser(cfg, history, (b) => postToCp2pRoom(b, { url: cfg.url, room: r, subject, body: String(body).slice(0, 20000), dryRun }));
  if (res.sent) {
    log[r] = Date.now();
    fs.mkdirSync(path.dirname(POST_LOG), { recursive: true });
    fs.writeFileSync(POST_LOG, JSON.stringify(log));
  }
  history.write({ kind: 'note', message: res.sent ? 'CP2P のルームに投稿した' : 'CP2P への投稿を試した（送らず）', room: r, subject: subject || '' });
  return res;
}
