// 歷史價格中繼（Yahoo chart）：每日收盤用來重建每天的帳戶總值與年度表現，每月收盤（含息）用來算 Beta。
// 只轉送代號；日期換成交易所當地日期（台股的月資料以台灣午夜為準，換成 UTC 會掉到上個月）。

export interface PriceSeries {
  d: string[]; // 交易所當地日期 YYYY-MM-DD
  c: number[]; // 收盤價（已依分割調整；要還原當時價格用 splits）
  a?: number[]; // 含息調整後收盤（只有月資料；算報酬用）
  splits: { date: string; ratio: number }[];
}
export interface HistoryResponse {
  series: Record<string, PriceSeries>;
  errors: Record<string, string>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TW_RE = /^\d{4,6}[A-Z]?$/;
// 美股代號、指數（^GSPC）、匯率（TWD=X）
const SYM_RE = /^(\^[A-Z0-9]{1,8}|[A-Z][A-Z0-9]{0,6}([.-][A-Z]{1,2})?|[A-Z]{3}=X|\d{4,6}[A-Z]?)$/;
export const MAX_HISTORY_SYMBOLS = 8; // 免費方案每次呼叫的 CPU 時間有限，前端分批請求

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round = (n: number) => Math.round(n * 1e4) / 1e4;

// Yahoo 的代號：BRK.B → BRK-B；台股先試上市 .TW 再試上櫃 .TWO
export function yahooCandidates(sym: string): string[] {
  if (TW_RE.test(sym)) return [`${sym}.TW`, `${sym}.TWO`];
  return [sym.replace('.', '-')];
}

export function parseChart(json: unknown, withAdj: boolean): PriceSeries | undefined {
  const res = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        meta?: { gmtoffset?: number };
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] };
        events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> };
      }
    | undefined;
  const ts = res?.timestamp;
  const close = res?.indicators?.quote?.[0]?.close;
  if (!ts?.length || !close) return undefined;
  const adj = res?.indicators?.adjclose?.[0]?.adjclose;
  const off = (res?.meta?.gmtoffset ?? 0) * 1000;
  const day = (t: number) => new Date(t * 1000 + off).toISOString().slice(0, 10);
  const out: PriceSeries = { d: [], c: [], splits: [], ...(withAdj ? { a: [] } : {}) };
  ts.forEach((t, i) => {
    const c = close[i];
    if (c == null || !(c > 0)) return;
    out.d.push(day(t));
    out.c.push(round(c));
    if (withAdj) out.a!.push(round(adj?.[i] ?? c));
  });
  for (const s of Object.values(res?.events?.splits ?? {})) {
    if (s.numerator > 0 && s.denominator > 0) out.splits.push({ date: day(s.date), ratio: s.numerator / s.denominator });
  }
  out.splits.sort((a, b) => a.date.localeCompare(b.date));
  return out.d.length ? out : undefined;
}

export async function getHistory(symbols: string[], interval: '1d' | '1mo', from: string, fetchFn: FetchFn, init: RequestInit = {}): Promise<HistoryResponse> {
  const out: HistoryResponse = { series: {}, errors: {} };
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  await Promise.all(
    symbols.map(async (sym) => {
      if (!SYM_RE.test(sym)) {
        out.errors[sym] = '代號格式不正確';
        return;
      }
      for (const y of yahooCandidates(sym)) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?period1=${p1}&period2=${p2}&interval=${interval}&events=split`;
          const res = await fetchFn(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!res.ok) continue;
          const s = parseChart(await res.json(), interval === '1mo');
          if (s) {
            out.series[sym] = s;
            return;
          }
        } catch {
          // 換下一個候選代號
        }
      }
      out.errors[sym] = 'Yahoo 查不到歷史價格';
    }),
  );
  return out;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const bad = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: JSON_HEADERS });

// GET /api/history?symbols=AAPL,^GSPC,2330&interval=1d&from=2024-05-01
export async function handleHistory(request: Request, fetchFn: FetchFn, init: RequestInit = {}): Promise<Response> {
  if (request.method !== 'GET') return bad('只接受 GET', 405);
  const url = new URL(request.url);
  const symbols = [...new Set((url.searchParams.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const interval = url.searchParams.get('interval');
  const from = url.searchParams.get('from') ?? '';
  if (!symbols.length) return bad('沒有代號');
  if (symbols.length > MAX_HISTORY_SYMBOLS) return bad(`一次最多 ${MAX_HISTORY_SYMBOLS} 檔`);
  if (interval !== '1d' && interval !== '1mo') return bad('interval 只能是 1d 或 1mo');
  if (!DATE_RE.test(from) || from < '2000-01-01') return bad('from 日期不正確');
  return new Response(JSON.stringify(await getHistory(symbols, interval, from, fetchFn, init)), { headers: JSON_HEADERS });
}
