// 美元兌台幣匯率：fawazahmed0/currency-api（免金鑰、每日更新、可查歷史日期）。
// 主要走 jsDelivr，失敗再試備援網址；回傳值必須是合理的數字才採用，否則回傳 null，不讓網站壞掉。
export interface FxQuote {
  rate: number; // 1 美元兌多少台幣
  date: string; // 匯率資料日期
  source: string;
}

const urls = (tag: string) => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
  `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];

// 合理範圍：近二十年 USD/TWD 大約在 27～35 之間，放寬到 15～60 防止明顯錯誤的資料
export const plausibleRate = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 15 && r < 60;

export async function fetchUsdTwd(when: 'latest' | string): Promise<FxQuote | null> {
  for (const url of urls(when)) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const j = await res.json();
      const rate = j?.usd?.twd;
      if (!plausibleRate(rate)) continue;
      const date = typeof j?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : when;
      return { rate: Math.round(rate * 10000) / 10000, date, source: url.includes('jsdelivr') ? 'currency-api（jsDelivr）' : 'currency-api（備援）' };
    } catch {
      /* 換下一個網址 */
    }
  }
  return null;
}
