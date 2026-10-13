// AI 専用ブラウザーの本体（Playwright の Chromium を動かす）
//
// 守りは 2 段:
//   1. 操作の段  … 文字の入力・選択・キー送信は、書き込み許可リストのページだけ
//   2. 通信の段  … POST などの送信の通信と WebSocket は、許可リストのページからだけ通す
// どちらも止めたら履歴に残す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SAFE_KEYS = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Tab']);

export function profileDir(name = process.env.AIB_PROFILE || 'main') {
  if (!/^[\w-]+$/.test(name)) throw new Error('プロファイル名は英数字と - _ だけ');
  return path.join(ROOT, 'data', `profile-${name}`);
}

// ページの中で動かす: 押せる・入れられる部品に番号をつけて一覧を返す
function labelElements({ max, query }) {
  const q = (query || '').toLowerCase();
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=searchbox], [role=textbox], [contenteditable=""], [contenteditable=true]';
  document.querySelectorAll('[data-aib-id]').forEach((e) => e.removeAttribute('data-aib-id'));
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
    n += 1;
    el.setAttribute('data-aib-id', String(n));
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    // query があれば、文字か HTML の id にその言葉を含むものだけ（番号は全体の通し番号のまま）
    if (q && !label.toLowerCase().includes(q) && !(el.id || '').toLowerCase().includes(q)) continue;
    const item = { id: n, tag, label };
    if (type) item.type = type;
    if (el.id) item.domId = el.id;
    if (tag === 'a') item.href = el.href;
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

// ページの中で動かす: 部品の性質を調べる（入力欄か・検索欄か・送信ボタンか）
function describeElement(el) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const form = el.form || el.closest('form');
  const isSubmit = (tag === 'button' && (type === '' || type === 'submit') && !!form) || (tag === 'input' && ['submit', 'image'].includes(type));
  return {
    tag, type, role,
    isLink: tag === 'a' || role === 'link',
    isPassword: type === 'password',
    isSearch: type === 'search' || role === 'searchbox' || /search|検索|query|^q$/i.test(el.getAttribute('name') || el.getAttribute('aria-label') || '') ||
      (!!form && (form.getAttribute('role') === 'search' || /search/i.test(form.getAttribute('action') || ''))),
    isSubmit,
    formMethod: form ? (form.getAttribute('method') || 'get').toLowerCase() : null,
  };
}

function readText({ maxChars, offset }) {
  const clean = (el) => (el ? el.innerText : '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // 本文らしい所（main・article）を先に。中身が少なすぎるときはページ全体を読む
  let text = clean(document.querySelector('main, article, [role=main]'));
  if (text.length < 200) text = clean(document.body);
  return { title: document.title, total: text.length, text: text.slice(offset, offset + maxChars) };
}

// セッションのクッキー（ブラウザーを閉じると消えるもの）を、プロファイルの横のファイルに残す・戻す
export function sessionStateFile(name = process.env.AIB_PROFILE || 'main') {
  return profileDir(name) + '.session.json';
}
export async function saveSessionState(context, name) {
  const cookies = (await context.cookies()).filter((c) => c.expires === -1);
  const f = sessionStateFile(name);
  fs.writeFileSync(f, JSON.stringify({ savedAt: new Date().toISOString(), cookies }), { mode: 0o600 });
  return cookies.length;
}

export class AIBrowser {
  constructor({ policy, history, headless = process.env.AIB_HEADED !== '1', profile } = {}) {
    this.policy = policy;
    this.history = history;
    this.headless = headless;
    this.profile = profile;
    this.context = null;
    this.page = null;
    this.blocked = [];      // 直近の操作のあいだに止めた通信
    this.queue = Promise.resolve();
  }

  async start() {
    if (this.context) return;
    const dir = profileDir(this.profile);
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.context = await chromium.launchPersistentContext(dir, {
        headless: this.headless,
        acceptDownloads: false,          // ダウンロードはしない
        serviceWorkers: 'block',         // 通信の見張りをすり抜けないように
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        viewport: { width: 1280, height: 900 },
      });
    } catch (e) {
      if (/ProcessSingleton|already in use|SingletonLock/i.test(e.message)) {
        throw new Error('ブラウザーのプロファイルが別のところで使用中です。AIB_PROFILE で別の名前を指定してください');
      }
      throw e;
    }
    const sf = sessionStateFile(this.profile);
    if (fs.existsSync(sf)) {
      try { await this.context.addCookies(JSON.parse(fs.readFileSync(sf, 'utf8')).cookies || []); } catch {}
    }
    await this.context.route('**/*', (route) => this.onRequest(route));
    await this.context.routeWebSocket(/.*/, (ws) => this.onWebSocket(ws));
    this.context.on('page', (p) => {
      this.page = p;
      this.history.write({ kind: 'note', message: '新しいタブが開いたので切り替えました', url: p.url() });
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }

  pageUrlOf(request) {
    try { return request.frame().page().url(); } catch { return this.page ? this.page.url() : ''; }
  }

  async onRequest(route) {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const browse = this.policy.checkBrowse(url);
    if (!browse.ok) return this.block(route, { url, method, reason: browse.reason });
    if (!SAFE_METHODS.has(method)) {
      // 送信の通信は「いま開いているページ」が許可リストのときだけ通す
      // （許可リスト外のページから許可リストのサイトへ送る、なりすましも止める）
      const pageUrl = this.pageUrlOf(req);
      const w = this.policy.checkWrite(pageUrl);
      if (!w.ok) return this.block(route, { url, method, pageUrl, reason: '許可リスト外のページからの送信' });
    }
    return route.continue();
  }

  block(route, info) {
    // 道具の実行中ならその記録にまとめる。実行していないとき（ページの仕掛けが勝手に送ろうとした等）はすぐ記録する
    if (this.running) this.blocked.push(info);
    else this.history.write({ kind: 'blocked', ...info });
    return route.abort('blockedbyclient');
  }

  onWebSocket(ws) {
    const pageUrl = this.page ? this.page.url() : '';
    const okBrowse = this.policy.checkBrowse(ws.url().replace(/^ws/, 'http')).ok;
    if (okBrowse && this.policy.checkWrite(pageUrl).ok) {
      ws.connectToServer();
      return;
    }
    const info = { url: ws.url(), method: 'WEBSOCKET', pageUrl, reason: '許可リスト外のページの WebSocket' };
    if (this.running) this.blocked.push(info);
    else this.history.write({ kind: 'blocked', ...info });
    ws.close({ code: 1008, reason: 'blocked by ai-browser policy' });
  }

  // 1 つずつ順番に実行し、必ず履歴に残す
  run(tool, args, fn, { write = false } = {}) {
    const job = this.queue.then(async () => {
      const t0 = Date.now();
      await this.start();
      this.blocked = [];
      this.running = true;
      const urlBefore = this.page.url();
      // write は true/false か、操作の前に判定する関数
      const isWrite = typeof write === 'function' ? write() : write;
      let result, error, shot;
      try {
        result = await fn();
      } catch (e) {
        error = e.message.split('\n')[0];
      }
      if (isWrite && this.policy.settings.screenshotOnWrite !== false && this.page) {
        shot = this.history.shotPath();
        await this.page.screenshot({ path: shot }).catch(() => { shot = undefined; });
      }
      this.running = false;
      const blocked = this.blocked.splice(0);
      this.history.write({
        kind: 'tool', tool, args,
        urlBefore, urlAfter: this.page ? this.page.url() : '',
        ok: !error && !(result && result.refused),
        refused: result && result.refused ? result.reason : undefined,
        error,
        summary: result && result.summary,
        blockedCount: blocked.length || undefined,
        blocked: blocked.length ? blocked.slice(0, 20) : undefined,
        screenshot: shot,
        ms: Date.now() - t0,
      });
      if (error) throw new Error(error);
      if (blocked.length) result.blockedNote = `止めた通信: ${blocked.length} 件（${blocked[0].reason}）`;
      return result;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  async settle() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  locator(id) {
    if (!Number.isInteger(id) || id < 1) throw new Error('element_id は 1 以上の整数');
    return this.page.locator(`[data-aib-id="${id}"]`).first();
  }

  async elementInfo(id) {
    const loc = this.locator(id);
    if (await loc.count() === 0) throw new Error(`部品 ${id} が見つかりません。list_elements で番号を取り直してください`);
    return { loc, info: await loc.evaluate(describeElement) };
  }

  refuse(reason) { return { refused: true, reason, summary: `断った: ${reason}` }; }

  writeAllowedHere() { return this.policy.checkWrite(this.page.url()); }

  // ---- 道具 ----

  openUrl(url) {
    return this.run('open_url', { url }, async () => {
      const c = this.policy.checkBrowse(url);
      if (!c.ok) return this.refuse(c.reason);
      const res = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.settle();
      const title = await this.page.title();
      return { url: this.page.url(), title, status: res ? res.status() : null, writeAllowed: this.writeAllowedHere().ok, summary: title };
    });
  }

  searchWeb(query) {
    return this.run('search_web', { query }, async () => {
      await this.page.goto('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const results = await this.page.$$eval('.result', (rows) => rows.slice(0, 10).map((r) => {
        const a = r.querySelector('a.result__a');
        if (!a) return null;
        let href = a.href;
        try { const u = new URL(href); if (u.searchParams.get('uddg')) href = u.searchParams.get('uddg'); } catch {}
        const snip = r.querySelector('.result__snippet');
        return { title: a.innerText.trim(), url: href, snippet: snip ? snip.innerText.trim().slice(0, 200) : '' };
      }).filter(Boolean));
      return { results, summary: `${results.length} 件` };
    });
  }

  readPage({ maxChars, offset = 0 } = {}) {
    const max = Math.min(maxChars || this.policy.settings.maxReadChars || 6000, 20000);
    return this.run('read_page', { maxChars: max, offset }, async () => {
      const r = await this.page.evaluate(readText, { maxChars: max, offset });
      return { url: this.page.url(), ...r, offset, writeAllowed: this.writeAllowedHere().ok, summary: `${r.title}（${r.total} 文字中 ${offset}〜）` };
    });
  }

  listElements({ max = 150, query } = {}) {
    return this.run('list_elements', query ? { max, query } : { max }, async () => {
      const items = await this.page.evaluate(labelElements, { max: Math.min(max, 400), query });
      return { url: this.page.url(), writeAllowed: this.writeAllowedHere().ok, elements: items, summary: `${items.length} 個` };
    });
  }

  click(id) {
    return this.run('click', { element_id: id }, async () => {
      const { loc, info } = await this.elementInfo(id);
      const allowed = this.writeAllowedHere();
      if (info.isSubmit && info.formMethod !== 'get' && !allowed.ok) {
        return this.refuse('送信ボタンです。このページは書き込み許可リストにありません');
      }
      await loc.click({ timeout: 10000 });
      await this.settle();
      return { url: this.page.url(), title: await this.page.title(), summary: `${info.tag} を押した` };
    }, { write: () => this.writeAllowedHere().ok });  // 許可リストのページで押したときは記録に画像も残す
  }

  typeText(id, text, submit = false) {
    return this.run('type_text', { element_id: id, text, submit }, async () => {
      const { loc, info } = await this.elementInfo(id);
      if (info.isPassword) return this.refuse('パスワード欄には AI は入力しません。人が手で入れてください（npm run login）');
      const allowed = this.writeAllowedHere();
      const searchOk = info.isSearch && this.policy.settings.allowSearchBoxEverywhere !== false;
      if (!allowed.ok && !searchOk) return this.refuse('このページは書き込み許可リストにないので、文字の入力はできません');
      await loc.fill(text, { timeout: 10000 });
      if (submit) { await loc.press('Enter'); await this.settle(); }
      return { url: this.page.url(), rule: allowed.ok ? allowed.rule : '検索欄', summary: `${text.length} 文字を入力${submit ? 'して送信' : ''}` };
    }, { write: true });
  }

  selectOption(id, value) {
    return this.run('select_option', { element_id: id, value }, async () => {
      const allowed = this.writeAllowedHere();
      if (!allowed.ok) return this.refuse('このページは書き込み許可リストにないので、選択はできません');
      const { loc } = await this.elementInfo(id);
      const picked = await loc.selectOption(value, { timeout: 10000 });
      return { selected: picked, summary: `「${value}」を選択` };
    }, { write: true });
  }

  pressKey(key) {
    const safe = SAFE_KEYS.has(key);
    return this.run('press_key', { key }, async () => {
      if (!safe && !this.writeAllowedHere().ok) return this.refuse(`${key} キーは書き込み許可リストのページだけで使えます`);
      await this.page.keyboard.press(key);
      await this.settle();
      return { url: this.page.url(), summary: `${key} を押した` };
    }, { write: !safe });
  }

  // ファイルを添付する（許可リストのページだけ・添付できるのは ai-browser の data/ の中のファイルだけ）
  attachFile(selector, file) {
    return this.run('attach_file', { selector, file: path.basename(file) }, async () => {
      if (!this.writeAllowedHere().ok) return this.refuse('このページは書き込み許可リストにないので、添付はできません');
      const real = fs.realpathSync(file);
      if (!real.startsWith(path.join(ROOT, 'data') + path.sep)) return this.refuse('添付できるのは ai-browser の data/ の中のファイルだけです');
      await this.page.setInputFiles(selector, real, { timeout: 10000 });
      return { summary: `${path.basename(real)} を添付` };
    }, { write: true });
  }

  scroll(direction = 'down') {
    return this.run('scroll', { direction }, async () => {
      await this.page.mouse.wheel(0, direction === 'up' ? -800 : 800);
      await this.page.waitForTimeout(400);
      return { summary: direction };
    });
  }

  goBack() {
    return this.run('go_back', {}, async () => {
      await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.settle();
      return { url: this.page.url(), title: await this.page.title(), summary: this.page.url() };
    });
  }

  screenshot({ fullPage = false } = {}) {
    return this.run('screenshot', { fullPage }, async () => {
      const file = this.history.shotPath();
      const buf = await this.page.screenshot({ path: file, fullPage });
      return { file, base64: buf.toString('base64'), url: this.page.url(), summary: file };
    });
  }

  listTabs() {
    return this.run('list_tabs', {}, async () => {
      const tabs = await Promise.all(this.context.pages().map(async (p, i) => ({ index: i, url: p.url(), title: await p.title(), active: p === this.page })));
      return { tabs, summary: `${tabs.length} 枚` };
    });
  }

  switchTab(index) {
    return this.run('switch_tab', { index }, async () => {
      const p = this.context.pages()[index];
      if (!p) throw new Error(`タブ ${index} はありません`);
      this.page = p;
      await p.bringToFront();
      return { url: p.url(), summary: p.url() };
    });
  }

  writePermission(url) {
    return this.run('write_permission', { url }, async () => {
      const target = url || this.page.url();
      const c = this.policy.checkWrite(target);
      return { url: target, ...c, allowlist: this.policy.listWriteAllowlist(), summary: c.ok ? '書き込み可' : '閲覧だけ' };
    });
  }
}
