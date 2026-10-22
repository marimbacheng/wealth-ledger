import type { Store } from '../domain/types';

// 前端取報價：只連自己網域的 /api/quotes（Cloudflare Worker 或開發伺服器轉送）。
export interface Quote {
  price: number;
  date: string;
  source: string;
  time?: string;
  prevClose?: number;
}
export interface QuoteResult {
  quotes: Record<string, Quote>;
  errors: Record<string, string>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 回應先驗證：價格必須是正數、日期格式正確，其餘丟掉
export function validQuotes(body: unknown): QuoteResult | null {
  const b = body as Partial<QuoteResult> | null;
  if (!b || typeof b !== 'object' || typeof b.quotes !== 'object' || b.quotes == null) return null;
  const quotes: Record<string, Quote> = {};
  for (const [sym, q] of Object.entries(b.quotes)) {
    if (q && typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0 && DATE_RE.test(String(q.date)) && typeof q.source === 'string') {
      const prev = typeof q.prevClose === 'number' && q.prevClose > 0 ? { prevClose: q.prevClose } : {};
      quotes[sym] = { price: q.price, date: q.date, source: q.source, ...(typeof q.time === 'string' ? { time: q.time } : {}), ...prev };
    }
  }
  const errors: Record<string, string> = {};
  for (const [sym, e] of Object.entries((b.errors as Record<string, unknown>) ?? {})) if (typeof e === 'string') errors[sym] = e;
  return { quotes, errors };
}

// 失敗重試一次；還是失敗就回傳 null，不丟例外
export async function fetchQuotes(us: string[], tw: string[], base = '/'): Promise<QuoteResult | null> {
  const qs = new URLSearchParams();
  if (us.length) qs.set('us', us.join(','));
  if (tw.length) qs.set('tw', tw.join(','));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}api/quotes?${qs}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const v = validQuotes(await res.json());
      if (v) return v;
    } catch {
      // 網路錯誤：重試一次
    }
  }
  return null;
}

// 套用報價：較新的日期才取代；同一天時不蓋掉使用者手動輸入的價格
export function applyQuotes(prices: Store['prices'], quotes: Record<string, Quote>): { prices: Store['prices']; updated: string[] } {
  const next = { ...prices };
  const updated: string[] = [];
  for (const [sym, q] of Object.entries(quotes)) {
    const cur = next[sym];
    if (cur && (cur.date > q.date || (cur.date === q.date && cur.source === '手動'))) continue;
    if (cur && cur.date === q.date && cur.price === q.price && cur.source === q.source && cur.prevClose === q.prevClose) continue;
    next[sym] = { price: q.price, date: q.date, source: q.source, ...(q.prevClose ? { prevClose: q.prevClose } : {}) };
    updated.push(sym);
  }
  return { prices: next, updated };
}

// 盤中每分鐘的報價只放在這台裝置（不進同步檔），以免每分鐘都加密上傳一次。
// 寫進帳本（會同步）的時機：手動更新、出現新的交易日、或距離上次寫入超過 30 分鐘
export const PERSIST_MS = 30 * 60 * 1000;
export function shouldPersist(prices: Store['prices'], quotes: Record<string, Quote>, lastPersistedAt: number, now: number, manual: boolean): boolean {
  if (manual || now - lastPersistedAt >= PERSIST_MS) return true;
  return Object.entries(quotes).some(([sym, q]) => !prices[sym] || q.date > prices[sym].date);
}
