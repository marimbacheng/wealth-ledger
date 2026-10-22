import { currencyOf, rateAt, txnCurrency } from '../domain/currency';
import type { Store, Txn } from '../domain/types';
import { CASH_SOURCES, computeLedgers, migrationSells, pickAnchor } from './ledger';
import { externalFlows } from './report';

// 每日帳戶總值、年度表現與 Beta。
// 持股與現金用交易紀錄從錨點快照往回推（之前）或往後推（之後），價格用歷史收盤（還原分割），
// 所以不需要每個月的對帳單；有對帳單的日子用來核對重建結果。

export interface PriceSeries {
  d: string[];
  c: number[];
  a?: number[];
  splits?: { date: string; ratio: number }[];
}
export type History = Record<string, PriceSeries>;

export const SPX = '^GSPC'; // 價格指數：交易日曆與 Beta 用
export const NDX = '^IXIC';
// 含息的總報酬指數：和組合（含股利）比較時用，才公平
export const SPX_TR = '^SP500TR';
export const NDX_TR = '^XCMP';
export const USDTWD = 'TWD=X';

// ---------- 價格 ----------

// 收盤價還原成當時的實際價格：之後發生的分割要乘回去
export function unadjusted(s: PriceSeries): { d: string[]; p: number[] } {
  const splits = s.splits ?? [];
  return {
    d: s.d,
    p: s.c.map((c, i) => c * splits.filter((x) => x.date > s.d[i]).reduce((a, x) => a * x.ratio, 1)),
  };
}

function lastAtOrBefore(d: string[], date: string): number {
  let lo = 0;
  let hi = d.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// 合併歷史收盤與帳本裡的價格（持倉快照、成交價、現價），取當天或之前最新的一筆；更早都沒有就用之後最早的
function pricer(store: Store, hist: History) {
  const m = new Map<string, { date: string; price: number }[]>();
  const add = (sym: string | undefined, date: string, price: number | undefined) => {
    if (!sym || !price || !(price > 0)) return;
    if (!m.has(sym)) m.set(sym, []);
    m.get(sym)!.push({ date, price });
  };
  for (const [sym, s] of Object.entries(hist)) {
    if (sym.startsWith('^') || sym.includes('=')) continue;
    const u = unadjusted(s);
    u.d.forEach((d, i) => add(sym, d, u.p[i]));
  }
  for (const snap of store.snapshots) for (const r of snap.rows) add(r.symbol, snap.date, r.price);
  for (const t of store.txns) if (t.type === 'BUY' || t.type === 'SELL') add(t.symbol, t.date, t.price);
  for (const [sym, q] of Object.entries(store.prices)) add(sym, q.date, q.price);
  const sorted = new Map(
    [...m].map(([k, xs]) => {
      xs.sort((a, b) => a.date.localeCompare(b.date));
      return [k, { d: xs.map((x) => x.date), p: xs.map((x) => x.price) }];
    }),
  );
  return (sym: string, date: string): number | undefined => {
    const xs = sorted.get(sym);
    if (!xs?.d.length) return undefined;
    const i = lastAtOrBefore(xs.d, date);
    return xs.p[i >= 0 ? i : 0];
  };
}

// ---------- 每日總值 ----------

export interface DailyPoint {
  date: string;
  value: number; // 美元，兩家券商合計
  schwab: number; // 只算 Schwab 帳戶（和 Schwab 的對帳單、餘額匯出比對用）
  flow: number; // 當天的外部資金流（入金為正；期初持股以當天市值計）
}

interface State {
  qty: Map<string, number>;
  usd: number;
  twd: number;
}
const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

// 分拆配股（例如 3M 分出 Solventum）會多出新公司的股數；代號可能帶 .WI（發行前交易）
const isSpinOff = (t: Txn) => t.type === 'OTHER' && !!t.qty && /SPIN OFF|分拆/i.test(`${t.note ?? ''} ${t.description ?? ''}`);

function applyTxn(st: State, t: Txn, sign: 1 | -1, cur: 'USD' | 'TWD') {
  if (t.symbol && t.qty && (t.type === 'BUY' || t.type === 'OPEN')) bump(st.qty, t.symbol, sign * t.qty);
  if (t.symbol && isSpinOff(t)) bump(st.qty, t.symbol.replace(/\.WI$/, ''), sign * t.qty!);
  // 券商轉換的證券轉出／轉入成對出現、股數相同（兩筆都記正數），互相抵銷，所以不處理
  if (t.symbol && t.qty && t.type === 'SELL') bump(st.qty, t.symbol, -sign * t.qty);
  if (CASH_SOURCES.has(t.source) && t.type !== 'OPEN') {
    if (cur === 'TWD') st.twd += sign * t.amount;
    else st.usd += sign * t.amount;
  }
}

export function dailyValues(store: Store, hist: History, from: string, to: string): DailyPoint[] {
  const anchor = pickAnchor(store);
  const px = pricer(store, hist);
  const fxSeries = hist[USDTWD];
  const fxAt = (date: string) => {
    const i = fxSeries ? lastAtOrBefore(fxSeries.d, date) : -1;
    return i >= 0 ? fxSeries!.c[i] : rateAt(store, date);
  };
  const cur = (t: Txn) => txnCurrency(t, store.securities);

  // Schwab：從錨點快照推到起算日。快照當天、快照後才發生的遷移賣出不在快照裡
  const led = computeLedgers(store, to);
  const sameDay = new Set(led.anchorPreSale && anchor ? migrationSells(store).filter((t) => t.date === anchor.date) : []);
  const afterSnap = (t: Txn) => !anchor || t.date > anchor.date || sameDay.has(t);
  const schwab: State = { qty: new Map((anchor?.rows ?? []).map((r) => [r.symbol, r.qty])), usd: anchor?.cash ?? 0, twd: 0 };
  const sTx = store.txns.filter((t) => t.broker === 'schwab' && t.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sTx) {
    if (!afterSnap(t) && t.date > from) applyTxn(schwab, t, -1, 'USD');
    if (afterSnap(t) && t.date <= from) applyTxn(schwab, t, 1, 'USD');
  }
  // 永豐：從零開始往後推
  const tw: State = { qty: new Map(), usd: 0, twd: 0 };
  const wTx = store.txns.filter((t) => t.broker === 'tw' && t.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  for (const t of wTx) if (t.date <= from) applyTxn(tw, t, 1, cur(t));

  const flows = externalFlows(store).filter((t) => t.date > from && t.date <= to);
  const flowUSD = (t: Txn, date: string) => {
    if (t.type === 'OPEN' && t.symbol && t.qty) {
      const p = px(t.symbol, date) ?? Math.abs(t.amount) / t.qty;
      return p * t.qty * (currencyOf(t.symbol, store.securities) === 'TWD' ? 1 / fxAt(date)! : 1);
    }
    return cur(t) === 'TWD' ? t.amount / (fxAt(date) ?? 1) : t.amount;
  };

  const dates = new Set<string>([from, to]);
  for (const d of hist[SPX]?.d ?? []) if (d > from && d < to) dates.add(d);
  for (const t of flows) dates.add(t.date);
  for (const p of store.valuePoints) if (p.date > from && p.date < to) dates.add(p.date);
  const days = [...dates].sort();

  const worth = (st: State, date: string) => {
    const k = 1 / (fxAt(date) ?? Infinity);
    let v = st.usd + st.twd * k;
    for (const [sym, q] of st.qty) {
      if (Math.abs(q) < 1e-6) continue;
      v += q * (px(sym, date) ?? 0) * (currencyOf(sym, store.securities) === 'TWD' ? k : 1);
    }
    return v;
  };

  const out: DailyPoint[] = [];
  let si = sTx.findIndex((t) => t.date > from);
  let wi = wTx.findIndex((t) => t.date > from);
  if (si < 0) si = sTx.length;
  if (wi < 0) wi = wTx.length;
  for (const date of days) {
    if (date > from) {
      for (; si < sTx.length && sTx[si].date <= date; si++) applyTxn(schwab, sTx[si], 1, 'USD');
      for (; wi < wTx.length && wTx[wi].date <= date; wi++) applyTxn(tw, wTx[wi], 1, cur(wTx[wi]));
    }
    const flow = date > from ? flows.filter((t) => t.date === date).reduce((a, t) => a + flowUSD(t, date), 0) : 0;
    const s = worth(schwab, date);
    out.push({ date, value: s + worth(tw, date), schwab: s, flow });
  }
  return out;
}

// 重建結果和對帳單、餘額匯出的 Schwab 帳戶總值比對（這些資料點只代表 Schwab 帳戶）
export interface Check {
  date: string;
  ours: number;
  official: number;
  note?: string;
}
export function checks(store: Store, points: DailyPoint[]): Check[] {
  const by = new Map(points.map((p) => [p.date, p]));
  return store.valuePoints
    .filter((v) => (v.source === 'balances' || v.source === 'statement') && v.value > 0 && by.has(v.date)) // 帳戶清空後的 0 不比對
    .map((v) => ({ date: v.date, ours: by.get(v.date)!.schwab, official: v.value, note: v.note }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 時間加權報酬指數：每天的報酬先扣掉當天的入金，所以入金多寡不會讓報酬看起來變好或變差
export function twrIndex(points: DailyPoint[]): { date: string; idx: number }[] {
  const out: { date: string; idx: number }[] = [];
  let idx = 1;
  points.forEach((p, i) => {
    if (i > 0) {
      const prev = points[i - 1].value;
      if (prev > 0) idx *= (p.value - p.flow) / prev;
    }
    out.push({ date: p.date, idx });
  });
  return out;
}

// ---------- 年度表現 ----------

export interface PeriodStats {
  from: string;
  to: string;
  ret: number; // 期間報酬
  maxRise: number; // 期間內從低點到之後高點的最大漲幅
  maxDrawdown: number; // 期間內從高點到之後低點的最大跌幅（負數）
}

export function periodStats(series: { date: string; idx: number }[], from: string, to: string): PeriodStats | undefined {
  const i0 = lastAtOrBefore(
    series.map((x) => x.date),
    from,
  ); // 每年只呼叫幾次，不必預先建索引
  const base = i0 >= 0 ? series[i0] : series.find((x) => x.date >= from);
  if (!base) return undefined;
  const pts = series.filter((x) => x.date > base.date && x.date <= to);
  if (!pts.length) return undefined;
  let peak = base.idx;
  let trough = base.idx;
  let dd = 0;
  let rise = 0;
  for (const p of pts) {
    peak = Math.max(peak, p.idx);
    dd = Math.min(dd, p.idx / peak - 1);
    rise = Math.max(rise, p.idx / trough - 1);
    trough = Math.min(trough, p.idx);
  }
  return { from: base.date, to: pts[pts.length - 1].date, ret: pts[pts.length - 1].idx / base.idx - 1, maxRise: rise, maxDrawdown: dd };
}

export interface YearRow {
  year: number;
  from: string;
  to: string;
  portfolio?: PeriodStats;
  spx?: PeriodStats;
  ndx?: PeriodStats;
}

// 每個日曆年一列；起算日所在的年份從起算日開始，今年算到資料日
export function yearlyRows(portfolio: { date: string; idx: number }[], hist: History, from: string, to: string): YearRow[] {
  const idx = (s?: PriceSeries) => (s ? s.d.map((d, i) => ({ date: d, idx: s.c[i] })) : []);
  const spx = idx(hist[SPX_TR] ?? hist[SPX]);
  const ndx = idx(hist[NDX_TR] ?? hist[NDX]);
  const rows: YearRow[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const start = y === Number(from.slice(0, 4)) ? from : `${y - 1}-12-31`;
    const end = y === Number(to.slice(0, 4)) ? to : `${y}-12-31`;
    rows.push({ year: y, from: start, to: end, portfolio: periodStats(portfolio, start, end), spx: periodStats(spx, start, end), ndx: periodStats(ndx, start, end) });
  }
  return rows;
}

// ---------- Beta ----------

// 每月含息報酬；台股先換成美元。月份用交易所當地日期
function monthlyReturns(s: PriceSeries, fx?: PriceSeries): Map<string, number> {
  const fxBy = fx ? new Map(fx.d.map((d, i) => [d.slice(0, 7), fx.c[i]])) : undefined;
  const lv: [string, number][] = [];
  s.d.forEach((d, i) => {
    const m = d.slice(0, 7);
    const p = (s.a ?? s.c)[i];
    const r = fxBy ? fxBy.get(m) : 1;
    if (p > 0 && r) lv.push([m, p / r]);
  });
  const out = new Map<string, number>();
  for (let i = 1; i < lv.length; i++) out.set(lv[i][0], lv[i][1] / lv[i - 1][1] - 1);
  return out;
}

// 近 60 個月的 Beta = 共變異數 ÷ 市場變異數；資料少於 24 個月不算
export function monthlyBeta(asset: PriceSeries, market: PriceSeries, fx?: PriceSeries, months = 60): number | undefined {
  const a = monthlyReturns(asset, fx);
  const m = monthlyReturns(market);
  const keys = [...a.keys()].filter((k) => m.has(k)).sort().slice(-months);
  if (keys.length < 24) return undefined;
  const x = keys.map((k) => m.get(k)!);
  const y = keys.map((k) => a.get(k)!);
  const mx = x.reduce((p, c) => p + c, 0) / x.length;
  const my = y.reduce((p, c) => p + c, 0) / y.length;
  let cov = 0;
  let v = 0;
  x.forEach((xi, i) => {
    cov += (xi - mx) * (y[i] - my);
    v += (xi - mx) ** 2;
  });
  return v > 0 ? cov / v : undefined;
}

// 算 Beta 用哪一檔：有美股 ADR 對應的台股（例如 2330 ↔ TSM）用 ADR，和 S&P 500 同幣別、同交易時間
export function betaSource(store: Store, symbol: string): { symbol: string; fx: boolean } {
  const adr = (store.settings.migration.mappings ?? []).find((m) => m.to === symbol && currencyOf(m.from, store.securities) === 'USD');
  if (adr) return { symbol: adr.from, fx: false };
  return { symbol, fx: currencyOf(symbol, store.securities) === 'TWD' };
}

// ---------- 資料起點與事件 ----------

// 交易紀錄連續涵蓋到錨點快照的最早日期：從這天起可以完整重建每日總值。
// 匯入多份 Schwab 交易紀錄時，涵蓋區間相接（間隔 4 天內，跨週末）就合併。
export function dataStart(store: Store): string | undefined {
  const anchor = pickAnchor(store);
  if (!anchor) return undefined;
  const iv = store.coverage
    .filter((c) => c.broker === 'schwab' && c.kind === 'transactions')
    .map((c) => [c.from, c.to] as const)
    .sort((a, b) => b[1].localeCompare(a[1]));
  let start = anchor.date;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [f, t] of iv) {
      const gap = (Date.parse(start) - Date.parse(t)) / 864e5;
      if (f < start && gap <= 4) {
        start = f;
        changed = true;
      }
    }
  }
  return start;
}

// ---------- 和指數比較 ----------

export interface BenchRow {
  date: string;
  value: number;
  flow?: number;
  spx?: number;
  ndx?: number;
}

// 同樣的金流改買指數：第一天的帳戶總值與之後每筆投入，都換成當天的指數單位
export function benchValues(rows: BenchRow[], k: 'spx' | 'ndx'): (number | undefined)[] {
  const p0 = rows[0]?.[k];
  if (!p0) return rows.map(() => undefined);
  let units = rows[0].value / p0;
  return rows.map((r, i) => {
    const p = r[k];
    if (!p) return undefined;
    if (i > 0 && r.flow) units += r.flow / p;
    return units * p;
  });
}
