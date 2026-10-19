import { metaFor } from '../domain/securities';
import type { Broker, Store, Txn } from '../domain/types';
import { inRange, yearOf } from './dates';
import { buildDividendEvents, summarizeDividends, type DividendSummary, type DividendTotals } from './dividends';
import { computeLedgers, type LedgerResult, type MigrationMatch, type PendingMigration } from './ledger';
import { xirr, type Flow } from './xirr';

export type DpsSource = 'override' | 'schwab-estimate' | 'last-div' | 'ttm' | 'none';
export const DPS_SOURCE_LABEL: Record<DpsSource, string> = {
  override: '手動設定',
  'schwab-estimate': 'Schwab 未來 12 個月預估',
  'last-div': '最近一次股利 × 年配息次數',
  ttm: '近 12 個月實領',
  none: '無資料',
};

export interface ForecastRow {
  symbol: string;
  qty: number;
  dps: number; // 年化每股股利（稅前）
  dpsSource: DpsSource;
  rate: number;
  rateSource: 'override' | 'observed' | 'default';
  gross: number;
  tax: number;
  net: number;
}

export interface HoldingRow {
  symbol: string;
  name: string;
  sector: string;
  assetClass: string;
  qty: number;
  schwabQty: number;
  twQty: number;
  price?: number;
  priceDate?: string;
  marketValue: number;
  weight: number;
  contCost: number;
  contGain: number;
  schwabCost: number; // 還在 Schwab 的股數，Schwab 帳上成本
  brokerCost: number; // 總成本 = Schwab 成本 + 永豐成本（各券商帳上實際成本）
  brokerGain: number;
  twCost: number;
  twValue: number;
  drip?: { qty: number; cost: number; count: number };
  dividends?: DividendTotals;
  forecast: ForecastRow;
}

export interface Report {
  asOf: string;
  anchorDate?: string;
  holdings: HoldingRow[];
  totals: {
    marketValue: number;
    contCost: number;
    contGain: number;
    brokerCost: number;
    brokerGain: number;
    twValue: number;
    twCost: number;
    twGain: number;
    schwabValue: number;
    schwabCash: number;
    twCash: number;
    pendingProceeds: number;
    totalValue: number;
  };
  realized: {
    continuous: number;
    continuousByYear: Record<number, number>;
    schwabReported: number;
    schwabByYear: Record<number, number>;
    tw: number;
    twByYear: Record<number, number>;
  };
  dividends: DividendSummary & { twYtd: DividendTotals; year: number };
  forecast: { label: string; rows: ForecastRow[]; gross: number; tax: number; net: number };
  yoc: { contGross?: number; contNet?: number; brokerGross?: number; brokerNet?: number; ttmContNet?: number };
  totalReturn: {
    unrealized: number;
    realized: number;
    pendingMigration: number; // 已在 Schwab 賣出、還沒買回（或還沒過買回期限）部分的損益
    dividendsNet: number;
    interest: number;
    fees: number;
    total: number;
    netContribution?: number;
    gainByContribution?: number;
    residual?: number;
    xirr?: number;
  };
  sectors: { name: string; value: number; weight: number }[];
  assetClasses: { name: string; value: number; weight: number }[];
  valueSeries: { date: string; value: number; contribution?: number; source: string }[];
  migration: { matches: MigrationMatch[]; pending: PendingMigration[] };
  coverage: { label: string; from: string; to: string }[];
  warnings: string[];
  ledgers: LedgerResult;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function emptyTotals(): DividendTotals {
  return { gross: 0, tax: 0, net: 0, count: 0, estimatedCount: 0, netOnlyCount: 0 };
}

// 外部資金流：Schwab 在遷移期間的匯出視為券商間移轉，不算提領
export function externalFlows(store: Store): Txn[] {
  const m = store.settings.migration;
  return store.txns.filter((t) => {
    if (t.type === 'DEPOSIT') return true;
    if (t.type !== 'WITHDRAW') return false;
    return !(t.broker === 'schwab' && inRange(t.date, m.schwabSellFrom, m.twBuyTo));
  });
}

function nextTwelveMonths(asOf: string): { from: string; to: string } {
  const y = yearOf(asOf);
  const mo = Number(asOf.slice(5, 7));
  const start = new Date(Date.UTC(y, mo, 1)); // 下個月 1 日
  const end = new Date(Date.UTC(y, mo + 12, 0)); // 第 12 個月最後一天
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function snapNearest(store: Store, date: string) {
  const s = store.snapshots.filter((x) => x.broker === 'schwab' && x.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  return s[s.length - 1];
}

function frequencyFrom(count: number): number {
  if (count <= 0) return 4;
  const options = [1, 2, 4, 12];
  return options.reduce((best, f) => (Math.abs(f - count) < Math.abs(best - count) ? f : best), 4);
}

export function buildReport(store: Store, asOf: string): Report {
  const led = computeLedgers(store, asOf);
  const events = buildDividendEvents(store).filter((e) => e.date <= asOf);
  const div = summarizeDividends(events, asOf);
  const warnings = [...led.warnings];

  // ---------- 持股 ----------
  const symbols = new Set([...Object.keys(led.schwab), ...Object.keys(led.tw), ...Object.keys(led.continuous)]);
  const est = store.estimates.find((e) => e.broker === 'schwab');
  const estWindow = est ? nextTwelveMonths(est.importedAt) : undefined;
  const estSnap = est ? snapNearest(store, est.importedAt) : undefined;
  const lastDiv = new Map((led.anchor?.rows ?? []).map((r) => [r.symbol, r.lastDiv]));

  const rows: HoldingRow[] = [];
  for (const symbol of symbols) {
    const sp = led.schwab[symbol];
    const tp = led.tw[symbol];
    const cp = led.continuous[symbol];
    const qty = (sp?.qty ?? 0) + (tp?.qty ?? 0);
    if (qty <= 1e-6) continue;
    const meta = metaFor(symbol, store.securities);
    const quote = store.prices[symbol];
    const price = quote?.price;
    if (price == null) warnings.push(`${symbol} 沒有價格，市值以 0 計；請在「設定」輸入現價或匯入最新持倉`);
    const mv = (price ?? 0) * qty;
    const brokerCost = (sp?.cost ?? 0) + (tp?.cost ?? 0);
    const contCost = cp?.cost ?? brokerCost;
    if (cp && Math.abs(cp.qty - qty) > 1e-4) {
      warnings.push(`${symbol} 延續帳股數 ${cp.qty.toFixed(4)} 與券商合計 ${qty.toFixed(4)} 不一致`);
    }

    // 股利預估
    let dps = 0;
    let dpsSource: DpsSource = 'none';
    const ttm = div.ttmBySymbol[symbol];
    if (meta.dpsOverride != null) {
      dps = meta.dpsOverride;
      dpsSource = 'override';
    } else if (est && estWindow && estSnap) {
      const estQty = estSnap.rows.find((r) => r.symbol === symbol)?.qty;
      const amt = sum(est.rows.filter((r) => r.symbol === symbol && inRange(r.date, estWindow.from, estWindow.to)).map((r) => r.amount));
      if (estQty && amt > 0) {
        dps = amt / estQty;
        dpsSource = 'schwab-estimate';
      }
    }
    if (dpsSource === 'none' && lastDiv.get(symbol)) {
      dps = lastDiv.get(symbol)! * frequencyFrom(ttm?.count ?? 0);
      dpsSource = 'last-div';
    }
    if (dpsSource === 'none' && ttm && ttm.gross > 0) {
      dps = ttm.gross / qty;
      dpsSource = 'ttm';
    }
    let rate = store.settings.defaultWithholding;
    let rateSource: ForecastRow['rateSource'] = 'default';
    if (meta.withholdingOverride != null) {
      rate = meta.withholdingOverride;
      rateSource = 'override';
    } else if (div.rates[symbol] != null) {
      rate = div.rates[symbol];
      rateSource = 'observed';
    }
    const gross = dps * qty;

    rows.push({
      symbol,
      name: meta.name ?? symbol,
      sector: meta.sector,
      assetClass: meta.assetClass,
      qty,
      schwabQty: sp?.qty ?? 0,
      twQty: tp?.qty ?? 0,
      price,
      priceDate: quote?.date,
      marketValue: mv,
      weight: 0,
      contCost,
      contGain: mv - contCost,
      schwabCost: sp?.cost ?? 0,
      brokerCost,
      brokerGain: mv - brokerCost,
      twCost: tp?.cost ?? 0,
      twValue: (price ?? 0) * (tp?.qty ?? 0),
      drip: led.drip[symbol],
      dividends: div.bySymbol[symbol]?.totals,
      forecast: { symbol, qty, dps, dpsSource, rate, rateSource, gross, tax: gross * rate, net: gross * (1 - rate) },
    });
  }
  const mvTotal = sum(rows.map((r) => r.marketValue));
  for (const r of rows) r.weight = mvTotal > 0 ? r.marketValue / mvTotal : 0;
  rows.sort((a, b) => b.marketValue - a.marketValue);

  // ---------- 現金與總值 ----------
  const pendingProceeds = sum(led.pending.map((p) => p.proceeds));
  if (led.schwabCash < -0.5) {
    warnings.push(`Schwab 現金推算為 ${led.schwabCash.toFixed(2)}：持倉快照之後可能還有同一天的交易沒有反映，請重新匯出最新的 Positions 與 Transactions`);
  }
  if (led.twCash < -0.5) warnings.push(`永豐現金推算為 ${led.twCash.toFixed(2)}：可能有匯入款（轉入）或交割款尚未登錄`);
  const totalValue = mvTotal + led.schwabCash + led.twCash;

  const totals: Report['totals'] = {
    marketValue: mvTotal,
    contCost: sum(rows.map((r) => r.contCost)),
    contGain: sum(rows.map((r) => r.contGain)),
    brokerCost: sum(rows.map((r) => r.brokerCost)),
    brokerGain: sum(rows.map((r) => r.brokerGain)),
    twValue: sum(rows.map((r) => r.twValue)),
    twCost: sum(rows.map((r) => r.twCost)),
    twGain: sum(rows.map((r) => r.twValue - r.twCost)),
    schwabValue: sum(rows.map((r) => (r.price ?? 0) * r.schwabQty)),
    schwabCash: led.schwabCash,
    twCash: led.twCash,
    pendingProceeds,
    totalValue,
  };

  // ---------- 已實現 ----------
  const anchorDate = led.anchor?.date ?? '0000-00-00';
  const byYear = (xs: { date: string; gain: number }[]) => {
    const o: Record<number, number> = {};
    for (const x of xs) o[yearOf(x.date)] = (o[yearOf(x.date)] ?? 0) + x.gain;
    return o;
  };
  const schwabReported = store.realized.filter((r) => r.broker === 'schwab').map((r) => ({ date: r.closedDate, gain: r.gain }));
  const contEvents = [
    ...schwabReported.filter((r) => r.date <= anchorDate),
    ...led.realized.filter((r) => r.ledger === 'continuous').map((r) => ({ date: r.date, gain: r.gain })),
  ];
  const twEvents = led.realized.filter((r) => r.ledger === 'tw').map((r) => ({ date: r.date, gain: r.gain }));
  const realized: Report['realized'] = {
    continuous: sum(contEvents.map((x) => x.gain)),
    continuousByYear: byYear(contEvents),
    schwabReported: sum(schwabReported.map((x) => x.gain)),
    schwabByYear: byYear(schwabReported),
    tw: sum(twEvents.map((x) => x.gain)),
    twByYear: byYear(twEvents),
  };

  // ---------- 股利：台灣券商今年 ----------
  const year = yearOf(asOf);
  const twYtd = emptyTotals();
  for (const e of events) {
    if (e.broker === 'tw' && yearOf(e.date) === year) {
      twYtd.gross += e.gross ?? 0;
      twYtd.tax += e.tax;
      twYtd.net += e.net;
      if (!e.adjustment) twYtd.count++;
      if (e.taxStatus === 'netOnly') twYtd.netOnlyCount++;
    }
  }

  // ---------- 預估股利與 YOC ----------
  const fRows = rows.map((r) => r.forecast);
  const fGross = sum(fRows.map((r) => r.gross));
  const fNet = sum(fRows.map((r) => r.net));
  const ratio = (a: number, b: number) => (b > 0 ? a / b : undefined);
  const ttmNet = sum(rows.map((r) => div.ttmBySymbol[r.symbol]?.net ?? 0));
  const fwin = nextTwelveMonths(asOf);
  const yoc: Report['yoc'] = {
    contGross: ratio(fGross, totals.contCost),
    contNet: ratio(fNet, totals.contCost),
    brokerGross: ratio(fGross, totals.brokerCost),
    brokerNet: ratio(fNet, totals.brokerCost),
    ttmContNet: ratio(ttmNet, totals.contCost),
  };

  // ---------- 總報酬 ----------
  const cashTx = store.txns.filter((t) => t.date <= asOf && t.source !== 'schwab-income');
  const interest = sum(cashTx.filter((t) => t.type === 'INTEREST').map((t) => t.amount));
  const fees = -sum(cashTx.filter((t) => t.type === 'FEE').map((t) => t.amount));
  const pendingMigration = sum(led.pending.map((p) => p.proceeds - p.originalCost));
  const total = totals.contGain + realized.continuous + pendingMigration + div.total.net + interest - fees;
  const tr: Report['totalReturn'] = {
    unrealized: totals.contGain,
    realized: realized.continuous,
    pendingMigration,
    dividendsNet: div.total.net,
    interest,
    fees,
    total,
  };
  const opening = store.settings.openingContribution;
  const flows = externalFlows(store).filter((t) => t.date <= asOf);
  const contribAt = (date: string) =>
    (opening && date >= opening.date ? opening.amount : 0) +
    sum(flows.filter((t) => t.date <= date && (!opening || t.date > opening.date)).map((t) => t.amount));
  if (opening) {
    const nc = contribAt(asOf);
    tr.netContribution = nc;
    tr.gainByContribution = totalValue - nc;
    tr.residual = tr.gainByContribution - total;
    const xf: Flow[] = [
      { date: opening.date, amount: -opening.amount },
      ...flows.filter((t) => t.date > opening.date).map((t) => ({ date: t.date, amount: -t.amount })),
      { date: asOf, amount: totalValue },
    ];
    tr.xirr = xirr(xf);
  }

  // ---------- 分布 ----------
  const group = (key: (r: HoldingRow) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.marketValue);
    const cash = led.schwabCash + Math.max(0, led.twCash);
    if (cash > 0.5) m.set('現金', (m.get('現金') ?? 0) + cash);
    const tot = sum([...m.values()]);
    return [...m.entries()].map(([name, value]) => ({ name, value, weight: tot > 0 ? value / tot : 0 })).sort((a, b) => b.value - a.value);
  };

  // ---------- 資產成長 ----------
  const prio: Record<string, number> = { manual: 4, balances: 3, statement: 2, snapshot: 1 };
  const byDate = new Map<string, (typeof store.valuePoints)[number]>();
  for (const p of store.valuePoints) {
    const cur = byDate.get(p.date);
    if (!cur || prio[p.source] > prio[cur.source]) byDate.set(p.date, p);
  }
  const valueSeries = [...byDate.values()]
    .filter((p) => p.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, value: p.value, source: p.source, contribution: opening ? contribAt(p.date) : undefined }));

  // ---------- 資料涵蓋範圍 ----------
  const KIND: Record<string, string> = { transactions: '交易紀錄', income: '股利（投資收益）', realized: '已實現損益' };
  const BROKER: Record<Broker, string> = { schwab: 'Schwab', tw: '永豐' };
  const coverage = mergeCoverage(store.coverage).map((c) => ({ label: `${BROKER[c.broker]} ${KIND[c.kind]}`, from: c.from, to: c.to }));

  return {
    asOf,
    anchorDate: led.anchor?.date,
    holdings: rows,
    totals,
    realized,
    dividends: { ...div, twYtd, year },
    forecast: { label: `${fwin.from.slice(0, 7)} ~ ${fwin.to.slice(0, 7)}`, rows: fRows, gross: fGross, tax: fGross - fNet, net: fNet },
    yoc,
    totalReturn: tr,
    sectors: group((r) => r.sector),
    assetClasses: group((r) => r.assetClass),
    valueSeries,
    migration: { matches: led.matches, pending: led.pending },
    coverage,
    warnings,
    ledgers: led,
  };
}

function mergeCoverage(cs: Store['coverage']): Store['coverage'] {
  const out: Store['coverage'] = [];
  const sorted = [...cs].sort((a, b) => a.broker.localeCompare(b.broker) || a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from));
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && last.broker === c.broker && last.kind === c.kind && c.from <= last.to) {
      if (c.to > last.to) last.to = c.to;
    } else out.push({ ...c });
  }
  return out;
}
