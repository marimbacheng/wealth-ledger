import type { Broker, Coverage, Store, Txn } from '../domain/types';
import { daysBetween, inRange, yearOf } from './dates';

// 股利稅務狀態：
// actual   = 稅前、預扣稅都來自券商紀錄（預扣 0 也算實際，例如 GRMN）
// estimated = 只有稅前（Schwab 投資收益檔較早的年度），預扣稅用該檔實際觀察到的稅率估算
// netOnly  = 只有稅後金額（例如台灣券商只給實收淨額）
export type TaxStatus = 'actual' | 'estimated' | 'netOnly';

export interface DividendEvent {
  broker: Broker;
  date: string;
  symbol: string;
  gross?: number;
  tax: number;
  net: number;
  taxStatus: TaxStatus;
  reinvested: boolean;
  source: string;
  rawAction?: string;
  adjustment?: boolean; // 沒有對應股利的單獨稅務調整
}

export interface DividendTotals {
  gross: number; // 已知稅前合計（netOnly 不計入）
  tax: number;
  net: number;
  count: number;
  estimatedCount: number;
  netOnlyCount: number;
}

const emptyTotals = (): DividendTotals => ({ gross: 0, tax: 0, net: 0, count: 0, estimatedCount: 0, netOnlyCount: 0 });

export function addTo(t: DividendTotals, e: DividendEvent): void {
  t.gross += e.gross ?? 0;
  t.tax += e.tax;
  t.net += e.net;
  if (!e.adjustment) t.count++;
  if (e.taxStatus === 'estimated') t.estimatedCount++;
  if (e.taxStatus === 'netOnly') t.netOnlyCount++;
}

function covered(coverage: Coverage[], broker: Broker, date: string): boolean {
  return coverage.some((c) => c.broker === broker && c.kind === 'transactions' && inRange(date, c.from, c.to));
}

// Schwab 動作名稱：Qual Div Reinvest、Reinvest Dividend；投資收益檔的 "Rev Non-Qualified Div" 也是再投入（已用交易紀錄比對確認）
const isReinvestAction = (raw?: string) => /reinvest|再投入|^rev /i.test(raw ?? '');

// Schwab 交易紀錄與投資收益檔會記到同一筆股利：同代號、金額相同、日期差 7 天內視為同一筆，保留交易紀錄那筆（它有預扣稅）
function dedupeIncome(divs: Txn[]): Txn[] {
  const primary = divs.filter((d) => d.source !== 'schwab-income');
  const used = new Set<Txn>();
  const out = [...primary];
  for (const inc of divs.filter((d) => d.source === 'schwab-income')) {
    const twin = primary.find(
      (p) =>
        !used.has(p) &&
        p.broker === inc.broker &&
        p.symbol === inc.symbol &&
        Math.abs(p.amount - inc.amount) < 0.01 &&
        Math.abs(daysBetween(p.date, inc.date)) <= 7,
    );
    if (twin) used.add(twin);
    else out.push(inc);
  }
  return out;
}

export function observedRates(events: DividendEvent[]): Record<string, number> {
  const acc: Record<string, { g: number; t: number }> = {};
  for (const e of events) {
    if (e.taxStatus !== 'actual' || e.adjustment || !e.gross) continue;
    const a = (acc[e.symbol] ??= { g: 0, t: 0 });
    a.g += e.gross;
    a.t += e.tax;
  }
  const out: Record<string, number> = {};
  for (const [s, a] of Object.entries(acc)) if (a.g > 0) out[s] = Math.round((a.t / a.g) * 1000) / 1000;
  return out;
}

export function buildDividendEvents(store: Store): DividendEvent[] {
  const divs = dedupeIncome(store.txns.filter((t) => t.type === 'DIV' && t.symbol));
  const taxes = store.txns.filter((t) => t.type === 'TAX' && t.symbol);
  const dripBuys = store.txns.filter((t) => t.type === 'BUY' && t.drip && t.symbol);
  // 動作名稱沒寫再投入（例如 O 的 "Non-Qualified Div"），但幾天內有同代號的再投入買進 → 也算再投入
  const reinvested = (d: Txn) =>
    isReinvestAction(d.rawAction) ||
    dripBuys.some((b) => b.broker === d.broker && b.symbol === d.symbol && daysBetween(d.date, b.date) >= -1 && daysBetween(d.date, b.date) <= 5);

  const events: (DividendEvent & { _txn: Txn })[] = divs.map((d) => ({
    _txn: d,
    broker: d.broker,
    date: d.date,
    symbol: d.symbol!,
    gross: d.netOnly ? undefined : d.amount,
    tax: 0,
    net: d.amount,
    taxStatus: d.netOnly ? 'netOnly' : 'actual',
    reinvested: reinvested(d),
    source: d.source,
    rawAction: d.rawAction,
  }));

  const withTax = new Set<DividendEvent>();
  const adjustments: DividendEvent[] = [];
  for (const t of taxes) {
    let best: (typeof events)[number] | undefined;
    let bestGap = Infinity;
    for (const e of events) {
      if (e.broker !== t.broker || e.symbol !== t.symbol || e.taxStatus === 'netOnly') continue;
      const gap = Math.abs(daysBetween(e.date, t.date));
      if (gap <= 5 && gap < bestGap) {
        best = e;
        bestGap = gap;
      }
    }
    const withheld = -t.amount; // TAX 的 amount 為負；退稅為正
    if (best) {
      best.tax += withheld;
      best.net = (best.gross ?? 0) - best.tax;
      withTax.add(best);
    } else {
      adjustments.push({
        broker: t.broker,
        date: t.date,
        symbol: t.symbol!,
        gross: 0,
        tax: withheld,
        net: -withheld,
        taxStatus: 'actual',
        reinvested: false,
        source: t.source,
        rawAction: t.rawAction,
        adjustment: true,
      });
    }
  }

  // 沒有預扣稅紀錄的股利：落在交易紀錄涵蓋期間內 → 實際就是 0；之外 → 估算
  const needEstimate: (typeof events)[number][] = [];
  for (const e of events) {
    if (e.taxStatus === 'netOnly' || withTax.has(e)) continue;
    if (e.source === 'schwab-income' && !covered(store.coverage, e.broker, e.date)) {
      e.taxStatus = 'estimated'; // 先標記，避免「預扣 0」被當成實際稅率
      needEstimate.push(e);
    }
  }
  const rates = observedRates(events);
  for (const e of needEstimate) {
    const override = store.securities[e.symbol]?.withholdingOverride;
    const rate = override ?? rates[e.symbol] ?? store.settings.defaultWithholding;
    e.tax = Math.round((e.gross ?? 0) * rate * 100) / 100;
    e.net = (e.gross ?? 0) - e.tax;
  }

  return [...events.map(({ _txn: _, ...e }) => e), ...adjustments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol),
  );
}

export interface DividendSummary {
  events: DividendEvent[];
  total: DividendTotals;
  byYear: { year: number; totals: DividendTotals; byBroker: Record<Broker, DividendTotals> }[];
  bySymbol: Record<string, { totals: DividendTotals; byBroker: Record<Broker, DividendTotals>; first?: string; last?: string }>;
  ttmBySymbol: Record<string, DividendTotals>;
  rates: Record<string, number>;
}

export function summarizeDividends(events: DividendEvent[], asOf: string): DividendSummary {
  const total = emptyTotals();
  const years = new Map<number, { totals: DividendTotals; byBroker: Record<Broker, DividendTotals> }>();
  const bySymbol: DividendSummary['bySymbol'] = {};
  const ttm: Record<string, DividendTotals> = {};
  const ttmFrom = `${yearOf(asOf) - 1}${asOf.slice(4)}`;

  for (const e of events) {
    addTo(total, e);
    const y = yearOf(e.date);
    const yr = years.get(y) ?? { totals: emptyTotals(), byBroker: { schwab: emptyTotals(), tw: emptyTotals() } };
    addTo(yr.totals, e);
    addTo(yr.byBroker[e.broker], e);
    years.set(y, yr);

    const s = (bySymbol[e.symbol] ??= { totals: emptyTotals(), byBroker: { schwab: emptyTotals(), tw: emptyTotals() } });
    addTo(s.totals, e);
    addTo(s.byBroker[e.broker], e);
    if (!e.adjustment) {
      if (!s.first || e.date < s.first) s.first = e.date;
      if (!s.last || e.date > s.last) s.last = e.date;
    }
    if (e.date > ttmFrom && e.date <= asOf) addTo((ttm[e.symbol] ??= emptyTotals()), e);
  }
  return {
    events,
    total,
    byYear: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v })),
    bySymbol,
    ttmBySymbol: ttm,
    rates: observedRates(events),
  };
}
