// CP2P（https://cp2p.eiwa-up.jp/）のルームに、📝 長文メッセージで投稿する
// 画面の操作はすべて AIBrowser の道具を通すので、許可リストと履歴の決まりがそのまま効く。
// 前もって `AIB_PROFILE=<名前> npm run login -- https://cp2p.eiwa-up.jp/` でログインしておくこと。

async function waitFor(page, fn, arg, timeout = 30000) {
  await page.waitForFunction(fn, arg, { timeout }).catch(() => {
    throw new Error('CP2P の画面が思ったとおりに出ませんでした（ログインが切れているかもしれません）');
  });
}

const visible = (id) => { const el = document.getElementById(id); return !!el && el.getBoundingClientRect().width > 0; };

async function findElement(browser, pred, what, query) {
  const { elements } = await browser.listElements({ max: 400, query });
  const el = elements.find(pred);
  if (!el) throw new Error(`CP2P の画面に「${what}」が見つかりません`);
  return el.id;
}

function must(result) {
  if (result && result.refused) throw new Error(`断られました: ${result.reason}`);
  return result;
}

// MarkDown を CP2P の文に合うふつうの文にする
export function toPlainText(md) {
  return md
    .replace(/^# .*\n+/, '')
    .replace(/^#{2,3} (.*)$/gm, '■ $1')
    .replace(/^\|[-| ]+\|$/gm, '')
    .replace(/^\| (.*) \|$/gm, (_, row) => '・' + row.split(/\s*\|\s*/).map((c) => c.replace(/\*\*/g, '').trim()).filter(Boolean).join(' ／ '))
    .replace(/^> /gm, '')
    .replace(/^<(https?:\/\/[^>]+)>$/gm, '$1')
    .replace(/ {2}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// room（ルーム名）か dmTo（友達の表示名・DM）のどちらかを渡す。attach は data/ の中の画像など 1 つ。
export async function postToCp2pRoom(browser, { url = 'https://cp2p.eiwa-up.jp/', room, dmTo, subject, body, attach, dryRun = false }) {
  if (!room && !dmTo) throw new Error('room（ルーム名）か dmTo（DM の相手）がありません');
  must(await browser.openUrl(url));
  const page = browser.page;
  if (/\/login/.test(page.url())) throw new Error('CP2P にログインしていません。npm run login で人がログインしてください');

  // 画面が出るのを待つ（ルームの中か、入る前の画面）
  await waitFor(page, () => !!document.getElementById('msg') && (document.getElementById('msg').getBoundingClientRect().width > 0 ||
    [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '参加' && b.getBoundingClientRect().width > 0)));

  let target;
  if (dmTo) {
    // 友達の一覧から「💬 相手の名前」を押して DM を開く
    must(await browser.click(await findElement(browser, (e) => e.domId === 'topFriendBtn', '友達ボタン', 'topFriendBtn')));
    await page.waitForTimeout(2500);
    must(await browser.click(await findElement(browser, (e) => e.tag === 'button' && e.label === `💬 ${dmTo}`, `友達「${dmTo}」の DM ボタン`, dmTo)));
    await waitFor(page, visible, 'msg');
    target = await page.evaluate(() => localStorage.getItem('p2p_room'));
    if (!/^dm__/.test(target || '')) throw new Error(`DM が開けませんでした（開いたのは「${target}」）`);
  } else {
    const inRoom = await page.evaluate(visible, 'msg');
    if (!inRoom) {
      const roomInput = await findElement(browser, (e) => e.tag === 'input' && (e.label === room || /room/i.test(e.domId || '')) && e.type !== 'password' && e.type !== 'checkbox', 'ルーム名の欄');
      must(await browser.typeText(roomInput, room));
      must(await browser.click(await findElement(browser, (e) => e.tag === 'button' && e.label === '参加', '参加ボタン')));
      await waitFor(page, visible, 'msg');
    }
    target = await page.evaluate(() => localStorage.getItem('p2p_room'));
    if (target !== room) throw new Error(`開いたルームが「${target}」で、「${room}」ではありません`);
  }
  await page.waitForTimeout(3000); // つながるのを待つ

  // 📝 長文の窓に件名と本文を入れる
  must(await browser.click(await findElement(browser, (e) => e.domId === 'longMsgBtn', '📝 長文ボタン', 'longMsgBtn')));
  await waitFor(page, visible, 'longMsgInput', 10000);
  if (subject) must(await browser.typeText(await findElement(browser, (e) => e.domId === 'longMsgSubject', '件名の欄', 'longMsgSubject'), subject));
  must(await browser.typeText(await findElement(browser, (e) => e.domId === 'longMsgInput', '本文の欄', 'longMsgInput'), body));
  if (attach) {
    must(await browser.attachFile('#longMsgFileInput', attach));
    await waitFor(page, visible, 'longMsgAttachChip', 10000);
  }

  if (dryRun) {
    const shot = await browser.screenshot();
    must(await browser.click(await findElement(browser, (e) => e.domId === 'longMsgCloseBtn', '閉じるボタン', 'longMsgCloseBtn')));
    return { sent: false, dryRun: true, room: target, screenshot: shot.file };
  }

  must(await browser.click(await findElement(browser, (e) => e.domId === 'longMsgSendBtn', '送信ボタン', 'longMsgSendBtn')));
  // 自分の投稿がルームの記録に入るのを確かめる（添付があると少し時間がかかる）
  const mark = (subject || body).slice(0, 20);
  await waitFor(page, ([r, m]) => (localStorage.getItem('p2p_room_history_' + r) || '').includes(m) ||
    (document.body.innerText || '').includes(m), [target, mark], 60000);
  await page.waitForTimeout(attach ? 8000 : 2000);
  return { sent: true, room: target };
}
