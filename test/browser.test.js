// 本物の Chromium で守りを確かめる（手元だけの小さなサーバーを相手にする）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-test-'));
process.env.AIB_HISTORY_DIR = path.join(tmp, 'history');
const { Policy } = await import('../src/policy.js');
const { History, readHistory } = await import('../src/history.js');
const { AIBrowser, profileDir } = await import('../src/browser.js');
const { callTool } = await import('../src/tools.js');

const posts = [];
const page = (title) => `<!doctype html><meta charset="utf-8"><title>${title}</title><main><h1>${title}</h1><p>本文です</p>
<form method="post" action="/submit"><input name="msg" id="msg"><input type="password" name="pw"><button>送信</button></form>
<form method="get" action="/search" role="search"><input type="search" name="q"><button>検索</button></form>
<a href="/allowed/form">許可のページへ</a></main>`;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method !== 'GET') { posts.push({ url: req.url, body }); res.end('ok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/search')) return res.end('<title>検索結果</title><main>結果</main>');
    res.end(page(req.url.startsWith('/allowed') ? '許可のページ' : 'ふつうのページ'));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const policyFile = path.join(tmp, 'policy.json');
fs.writeFileSync(policyFile, JSON.stringify({ writeAllowlist: [`${base}/allowed/*`], blockedHosts: [], blockPrivateNetwork: false, allowSearchBoxEverywhere: true }));
const history = new History({ client: 'test' });
const b = new AIBrowser({ policy: new Policy(policyFile), history, profile: 'test' });

const ids = async () => {
  const r = await callTool(b, 'list_elements', {});
  const find = (pred) => r.elements.find(pred).id;
  return {
    msg: find((e) => e.tag === 'input' && !e.type),
    pw: find((e) => e.type === 'password'),
    send: find((e) => e.label === '送信'),
    search: find((e) => e.type === 'search'),
    link: find((e) => e.tag === 'a'),
  };
};

test.after(async () => {
  await b.close();
  server.close();
  fs.rmSync(profileDir('test'), { recursive: true, force: true });
});

test('許可リスト外: 閲覧はできる・入力と送信は断る・通信も止める', async () => {
  const o = await callTool(b, 'open_url', { url: `${base}/open/form` });
  assert.equal(o.title, 'ふつうのページ');
  assert.equal(o.writeAllowed, false);
  assert.match((await callTool(b, 'read_page', {})).text, /本文です/);
  const e = await ids();
  assert.ok((await callTool(b, 'type_text', { element_id: e.msg, text: 'こんにちは' })).refused);
  assert.ok((await callTool(b, 'click', { element_id: e.send })).refused);
  assert.ok((await callTool(b, 'press_key', { key: 'Enter' })).refused);
  // ページの中の仕掛け（スクリプト）が勝手に送ろうとしても通信の段で止まる
  await b.page.evaluate((u) => fetch(u, { method: 'POST', body: 'x' }).catch(() => {}), `${base}/allowed/steal`);
  await b.page.evaluate(() => navigator.sendBeacon('/beacon', 'x'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(posts.length, 0);
});

test('許可リスト外でも検索欄は使える（GET の検索）', async () => {
  await callTool(b, 'open_url', { url: `${base}/open/form` });
  const e = await ids();
  const r = await callTool(b, 'type_text', { element_id: e.search, text: 'ニュース', submit: true });
  assert.ok(!r.refused);
  assert.match(b.page.url(), /\/search\?q=/);
});

test('許可リストのページ: 入力して送信できる・パスワードは断る', async () => {
  await callTool(b, 'open_url', { url: `${base}/allowed/form` });
  const e = await ids();
  assert.ok((await callTool(b, 'type_text', { element_id: e.pw, text: 'secret' })).refused);
  assert.ok(!(await callTool(b, 'type_text', { element_id: e.msg, text: 'こんにちは' })).refused);
  assert.ok(!(await callTool(b, 'click', { element_id: e.send })).refused);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(posts.length, 1);
  assert.match(decodeURIComponent(posts[0].body), /msg=こんにちは/);
});

test('自宅のネットワークの宛先は開けない（既定の決まり）', async () => {
  const p2 = path.join(tmp, 'policy2.json');
  fs.writeFileSync(p2, JSON.stringify({ writeAllowlist: [], blockedHosts: ['localhost'], blockPrivateNetwork: true }));
  const b2 = new AIBrowser({ policy: new Policy(p2), history, profile: 'test2' });
  try {
    assert.ok((await callTool(b2, 'open_url', { url: `${base}/open/form` })).refused);
  } finally {
    await b2.close();
    fs.rmSync(profileDir('test2'), { recursive: true, force: true });
  }
});

test('すべての操作が履歴に残る（断ったもの・止めた通信・画像も）', async () => {
  const blocked = readHistory({ limit: 500, filter: (r) => r.kind === 'blocked' });
  assert.ok(blocked.some((r) => r.method === 'POST' && r.url.endsWith('/allowed/steal')), '許可リスト外のページから許可リストのサイトへの送信');
  assert.ok(blocked.some((r) => r.url.endsWith('/beacon')));
  const items = readHistory({ limit: 500, filter: (r) => r.kind === 'tool' });
  assert.ok(items.length >= 10);
  assert.ok(items.some((r) => r.refused && r.tool === 'type_text'));
  assert.ok(items.some((r) => r.screenshot && fs.existsSync(r.screenshot)));
  assert.ok(items.some((r) => r.tool === 'type_text' && r.args.text === 'こんにちは' && r.ok));
});
