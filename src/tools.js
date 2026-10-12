// 道具の定義（Claude の MCP と、自宅 AI の Ollama の両方で同じものを使う）
// inputSchema は JSON Schema。説明は短く（小さいローカル AI でも読めるように）。
import { readHistory } from './history.js';

const id = { type: 'integer', description: 'list_elements で見た部品の番号' };

export const TOOLS = [
  {
    name: 'open_url',
    description: 'URL を開く。閲覧はどのサイトでも自由（自宅のネットワークの宛先は不可）。',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http か https の URL' } }, required: ['url'] },
    run: (b, a) => b.openUrl(a.url),
  },
  {
    name: 'search_web',
    description: 'ウェブを検索して、上位 10 件の題名と URL を返す。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: (b, a) => b.searchWeb(a.query),
  },
  {
    name: 'read_page',
    description: '今のページの本文を文字で読む。長いときは offset で続きを読む。',
    inputSchema: { type: 'object', properties: { offset: { type: 'integer', description: '何文字目から読むか（既定 0）' }, max_chars: { type: 'integer' } } },
    run: (b, a) => b.readPage({ offset: a.offset || 0, maxChars: a.max_chars }),
  },
  {
    name: 'list_elements',
    description: '今のページのリンク・ボタン・入力欄に番号をつけて一覧にする。click や type_text の前に使う。',
    inputSchema: { type: 'object', properties: { max: { type: 'integer', description: '最大の数（既定 150）' } } },
    run: (b, a) => b.listElements({ max: a.max || 150 }),
  },
  {
    name: 'click',
    description: '部品を押す。リンクはどこでも押せる。送信ボタンは書き込み許可リストのページだけ。',
    inputSchema: { type: 'object', properties: { element_id: id }, required: ['element_id'] },
    run: (b, a) => b.click(a.element_id),
  },
  {
    name: 'type_text',
    description: '入力欄に文字を入れる。書き込み許可リストのページだけ（検索欄はどこでも可）。パスワードは入れない。',
    inputSchema: { type: 'object', properties: { element_id: id, text: { type: 'string' }, submit: { type: 'boolean', description: 'true なら入力のあと Enter' } }, required: ['element_id', 'text'] },
    run: (b, a) => b.typeText(a.element_id, a.text, !!a.submit),
  },
  {
    name: 'select_option',
    description: '選択肢（select）を選ぶ。書き込み許可リストのページだけ。',
    inputSchema: { type: 'object', properties: { element_id: id, value: { type: 'string' } }, required: ['element_id', 'value'] },
    run: (b, a) => b.selectOption(a.element_id, a.value),
  },
  {
    name: 'press_key',
    description: 'キーを押す。PageDown・矢印・Escape などはどこでも可。Enter などは書き込み許可リストのページだけ。',
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: '例: PageDown, Enter' } }, required: ['key'] },
    run: (b, a) => b.pressKey(a.key),
  },
  {
    name: 'scroll',
    description: 'ページを上か下へ動かす。',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] } } },
    run: (b, a) => b.scroll(a.direction || 'down'),
  },
  {
    name: 'go_back',
    description: '前のページへ戻る。',
    inputSchema: { type: 'object', properties: {} },
    run: (b) => b.goBack(),
  },
  {
    name: 'screenshot',
    description: '今の画面の画像を撮る（履歴のフォルダにも保存する）。',
    inputSchema: { type: 'object', properties: { full_page: { type: 'boolean' } } },
    run: (b, a) => b.screenshot({ fullPage: !!a.full_page }),
  },
  {
    name: 'list_tabs',
    description: '開いているタブの一覧。',
    inputSchema: { type: 'object', properties: {} },
    run: (b) => b.listTabs(),
  },
  {
    name: 'switch_tab',
    description: 'タブを切り替える。',
    inputSchema: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] },
    run: (b, a) => b.switchTab(a.index),
  },
  {
    name: 'write_permission',
    description: 'その URL（省略なら今のページ）で書き込みができるかと、書き込み許可リストを返す。',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    run: (b, a) => b.writePermission(a.url),
  },
  {
    name: 'recent_history',
    description: 'このブラウザーの操作の履歴（新しい順）。',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: '既定 20' } } },
    run: async (b, a) => {
      const items = readHistory({ limit: Math.min(a.limit || 20, 200), filter: (r) => r.kind === 'tool' });
      return { items: items.map((r) => ({ ts: r.ts, client: r.client, tool: r.tool, args: r.args, ok: r.ok, refused: r.refused, url: r.urlAfter })) };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// AI に返す文字（画像の base64 や内部用の欄は除く）
export function resultToText(result) {
  if (result == null) return 'ok';
  const { base64, summary, ...rest } = result;
  return JSON.stringify(rest, null, 1);
}

export async function callTool(browser, name, args = {}) {
  const t = TOOL_MAP.get(name);
  if (!t) throw new Error(`道具 ${name} はありません`);
  return t.run(browser, args || {});
}
