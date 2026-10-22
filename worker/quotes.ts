// 報價中繼：台股用證交所（上市）與櫃買中心（上櫃）的官方 OpenAPI 每日收盤，美股用 Yahoo 的 chart 介面（非官方）。
// 這些來源都沒有開放瀏覽器跨網域呼叫，所以由 Cloudflare Worker（開發時由 Vite）轉送；前端只連自己的網域。
// 只轉送代號，不含股數或金額；代號格式先驗證，不當成任意網址的代理。

export interface Quote {
  price: number;
  date: string; // 價格所屬的交易日（交易所當地日期）
  source: string;
  time?: string; // Yahoo：最近成交時間（ISO）
}

export interface QuotesResponse {
  quotes: Record<string, Quote>;
  errors: Record<string, string>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TW_RE = /^\d{4,6}[A-Z]?$/;
const US_RE = /^[A-Z][A-Z0-9]{0,6}([.-][A-Z]{1,2})?$/;
export const MAX_SYMBOLS = 60;

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const yahooUrl = (sym: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;

// 民國日期 1151021 → 2026-10-21
export function rocDate(s: unknown): string | undefined {
  const m = String(s ?? '').match(/^(\d{2,3})(\d{2})(\d{2})$/);
  return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : undefined;
}

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// 證交所與櫃買中心的每日收盤：欄位名稱不同，其餘相同
export function parseTwClose(rows: unknown, codes: Set<string>, fields: { code: string; close: string }, source: string, out: QuotesResponse) {
  if (!Array.isArray(rows)) return;
  for (const r of rows as Record<string, unknown>[]) {
    const code = String(r?.[fields.code] ?? '').trim();
    if (!codes.has(code) || out.quotes[code]) continue;
    const price = num(r[fields.close]);
    const date = rocDate(r.Date);
    if (price && date) out.quotes[code] = { price, date, source };
    else out.errors[code] = `${source}當日沒有成交價`;
  }
}

export const yahooSymbol = (sym: string) => sym.replace('.', '-');

// 交易所當地日期：美股收盤時台灣已是隔天，不能用 UTC 或台灣時間
function localDate(epochSec: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epochSec * 1000));
}

export function parseYahoo(json: unknown): Quote | undefined {
  const meta = (json as { chart?: { result?: { meta?: Record<string, unknown> }[] } })?.chart?.result?.[0]?.meta;
  const price = num(meta?.regularMarketPrice);
  const t = Number(meta?.regularMarketTime);
  if (!price || !Number.isFinite(t) || t <= 0) return undefined;
  const tz = typeof meta?.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : 'America/New_York';
  return { price, date: localDate(t, tz), source: 'Yahoo', time: new Date(t * 1000).toISOString() };
}

const list = (v: string | null) =>
  [...new Set((v ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];

async function getJson(fetchFn: FetchFn, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getQuotes(us: string[], tw: string[], fetchFn: FetchFn, init: RequestInit = {}): Promise<QuotesResponse> {
  const out: QuotesResponse = { quotes: {}, errors: {} };
  const twOk = tw.filter((s) => TW_RE.test(s));
  const usOk = us.filter((s) => US_RE.test(s));
  for (const s of [...tw, ...us]) if (!twOk.includes(s) && !usOk.includes(s)) out.errors[s] = '代號格式不正確';

  const twTask = (async () => {
    if (!twOk.length) return;
    const codes = new Set(twOk);
    try {
      parseTwClose(await getJson(fetchFn, TWSE_URL, init), codes, { code: 'Code', close: 'ClosingPrice' }, '證交所', out);
    } catch (e) {
      for (const c of codes) out.errors[c] = `證交所無法連線（${(e as Error).message}）`;
    }
    // 上市找不到的代號，再到上櫃找（例如債券 ETF）
    const rest = new Set(twOk.filter((c) => !out.quotes[c]));
    if (!rest.size) return;
    try {
      parseTwClose(await getJson(fetchFn, TPEX_URL, init), rest, { code: 'SecuritiesCompanyCode', close: 'Close' }, '櫃買中心', out);
      for (const c of rest) if (out.quotes[c]) delete out.errors[c];
      for (const c of rest) if (!out.quotes[c] && !out.errors[c]) out.errors[c] = '證交所與櫃買中心都查不到這個代號';
    } catch (e) {
      for (const c of rest) out.errors[c] ??= `櫃買中心無法連線（${(e as Error).message}）`;
    }
  })();

  const usTasks = usOk.map(async (s) => {
    try {
      const q = parseYahoo(await getJson(fetchFn, yahooUrl(yahooSymbol(s)), { ...init, headers: { 'User-Agent': 'Mozilla/5.0' } }));
      if (q) out.quotes[s] = q;
      else out.errors[s] = 'Yahoo 沒有回傳價格';
    } catch (e) {
      out.errors[s] = `Yahoo 無法取得（${(e as Error).message}）`;
    }
  });

  await Promise.all([twTask, ...usTasks]);
  return out;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

// GET /api/quotes?us=AAPL,BRK.B&tw=2330,006208
export async function handleQuotes(request: Request, fetchFn: FetchFn, init: RequestInit = {}): Promise<Response> {
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: '只接受 GET' }), { status: 405, headers: JSON_HEADERS });
  const url = new URL(request.url);
  const us = list(url.searchParams.get('us'));
  const tw = list(url.searchParams.get('tw'));
  if (us.length + tw.length === 0) return new Response(JSON.stringify({ error: '沒有代號' }), { status: 400, headers: JSON_HEADERS });
  if (us.length + tw.length > MAX_SYMBOLS) return new Response(JSON.stringify({ error: `一次最多 ${MAX_SYMBOLS} 檔` }), { status: 400, headers: JSON_HEADERS });
  return new Response(JSON.stringify(await getQuotes(us, tw, fetchFn, init)), { headers: JSON_HEADERS });
}
