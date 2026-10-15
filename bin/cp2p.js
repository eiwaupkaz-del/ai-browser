#!/usr/bin/env node
// CP2P のルームを読む・書く（愛ちゃん(Ai) などログインしたアカウントで・画面の操作）
//   npm run cp2p -- read <ルーム> [--hours 24] [--limit 30]
//   npm run cp2p -- post <ルーム> --body "本文" [--subject "件名"] [--dry-run]
//   npm run cp2p -- post <ルーム> --body-file <ファイル> [--subject "件名"] [--dry-run]
// 使えるルームと投稿の間隔は config/cp2p.json（なければ見本 config/cp2p.example.json）。
import fs from 'node:fs';
import { History } from '../src/history.js';
import { cp2pRead, cp2pPost } from '../src/cp2p-rooms.js';

const [cmd, room, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const history = new History({ client: 'cp2p-cli' });

try {
  if (cmd === 'read' && room) {
    const r = await cp2pRead(history, { room, hours: opt('hours'), limit: opt('limit') });
    console.log(`【${r.room} の過去 ${r.hours} 時間・${r.count} 件（古い順）】`);
    for (const m of r.messages) console.log(`- ${m.at} ${m.name}${m.private ? `（${m.private}）` : ''}: ${m.text.replace(/\n+/g, ' / ')}`);
  } else if (cmd === 'post' && room) {
    const body = opt('body-file') ? fs.readFileSync(opt('body-file'), 'utf8') : opt('body');
    const r = await cp2pPost(history, { room, subject: opt('subject'), body, dryRun: rest.includes('--dry-run') });
    console.log(r.sent ? `「${r.room}」に投稿しました` : `「${r.room}」への投稿を試しました（送っていません）${r.screenshot ? ` 画面: ${r.screenshot}` : ''}`);
  } else {
    console.error('使い方: npm run cp2p -- read <ルーム> [--hours 24] ／ npm run cp2p -- post <ルーム> --body "本文" [--subject "件名"] [--dry-run]');
    process.exit(2);
  }
} catch (e) {
  console.error(`エラー: ${e.message}`);
  process.exit(1);
}
