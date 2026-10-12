import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Policy, patternToRegExp } from '../src/policy.js';

function tmpPolicy(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aib-')), 'policy.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

test('pattern の * は何でも・それ以外はそのまま', () => {
  const re = patternToRegExp('https://example.com/post/*');
  assert.ok(re.test('https://example.com/post/1'));
  assert.ok(!re.test('https://example.com.evil.jp/post/1'));
  assert.ok(!re.test('https://evil.jp/?https://example.com/post/1'));
});

test('閲覧: http/https だけ・自宅のネットワークは不可', () => {
  const p = new Policy(tmpPolicy({ writeAllowlist: [], blockedHosts: ['localhost'], blockPrivateNetwork: true }));
  assert.ok(p.checkBrowse('https://www.city.example.jp/').ok);
  for (const u of ['file:///etc/passwd', 'http://localhost:3000', 'http://192.168.1.1/', 'http://10.0.0.5', 'http://100.100.1.2:11434', 'http://[::1]/', 'http://printer.local/', 'javascript:alert(1)']) {
    assert.equal(p.checkBrowse(u).ok, false, u);
  }
});

test('書き込み: 許可リストだけ・URL の # は無視', () => {
  const p = new Policy(tmpPolicy({ writeAllowlist: ['https://x.example/*', { pattern: 'https://y.example/form', note: '' }] }));
  assert.ok(p.checkWrite('https://x.example/a/b?c=1').ok);
  assert.ok(p.checkWrite('https://y.example/form#top').ok);
  assert.equal(p.checkWrite('https://y.example/form2').ok, false);
  assert.equal(p.checkWrite('https://z.example/').ok, false);
});

test('ファイルを書き換えると読み直す', async () => {
  const f = tmpPolicy({ writeAllowlist: [] });
  const p = new Policy(f);
  assert.equal(p.checkWrite('https://x.example/').ok, false);
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(f, JSON.stringify({ writeAllowlist: ['https://x.example/*'] }));
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.ok(p.checkWrite('https://x.example/').ok);
});

test('見本の設定ファイルが読める', () => {
  const p = new Policy(new URL('../config/policy.example.json', import.meta.url).pathname);
  assert.ok(p.listWriteAllowlist().length >= 1);
});
