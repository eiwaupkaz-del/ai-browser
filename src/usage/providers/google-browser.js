// Google（Gemini）の予備の方法: AI Studio の使用量の画面を ai-browser で「読むだけ」（google.js の method: "screen"）
// ※ Google はプログラムで動かすブラウザーでのログインを止めることがあるため、ふだんは BigQuery の方法を使う
// 正式な数字の入口が手軽でないため、画面の文字と画像を記録する（数字は参考値）。
// 前もって AIB_PROFILE=google npm run login -- https://aistudio.google.com/ で人がログインしておく。
import { AIBrowser } from '../../browser.js';

export default {
  name: 'google-screen',
  label: 'Google（Gemini・画面）',
  browser: true,
  async collect({ cfg = {}, policy, history }) {
    const url = cfg.url || 'https://aistudio.google.com/usage';
    const b = new AIBrowser({ policy, history, profile: cfg.profile || 'google' });
    try {
      const o = await b.openUrl(url);
      if (o.refused) throw new Error(o.reason);
      if (/accounts\.google\.com/.test(b.page.url())) {
        return { records: [], notes: [{ kind: 'login', label: 'Google のログインが切れています', value: `AIB_PROFILE=${cfg.profile || 'google'} npm run login -- https://aistudio.google.com/` }] };
      }
      await b.page.waitForTimeout(Number(cfg.waitMs || 8000)); // 画面の数字が出るのを待つ
      const page = await b.readPage({ maxChars: 8000 });
      const shot = await b.screenshot({ fullPage: true });
      const amounts = [...new Set((page.text.match(/(?:US\$|\$|＄)\s?[\d,]+(?:\.\d+)?/g) || []))].slice(0, 10);
      return {
        records: [],
        notes: [
          { kind: 'screen', label: '使用量の画面を記録しました（数字は画面の参考値）', value: shot.file },
          ...(amounts.length ? [{ kind: 'amounts', label: '画面にあった金額', value: amounts.join(' / ') }] : []),
        ],
        raw: { url: b.page.url(), title: page.title, text: page.text.slice(0, 3000) },
      };
    } finally {
      await b.close();
    }
  },
};
