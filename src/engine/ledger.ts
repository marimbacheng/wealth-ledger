import type { Broker, PositionSnapshot, Store, Txn } from '../domain/types';
import { inRange } from './dates';

// 平均成本池：台灣複委託 App 多以平均成本（含手續費）顯示，延續帳也用同一套，對帳時才看得懂。
interface Pool {
  qty: number;
  cost: number;
}

const EPS = 1e-6;

export interface RealizedEvent {
  ledger: 'schwab' | 'tw' | 'continuous';
  date: string;
  symbol: string;
  qty: number;
  proceeds: number;
  cost: number;
  gain: number;
  note?: string;
}

// 遷移配對：Schwab 賣出 ↔ 複委託買回
export interface MigrationMatch {
  symbol: string;
  sellDate: string;
  buyDate: string;
  qty: number;
  originalCost: number; // 這些股數在 Schwab 的原始成本
  proceeds: number; // Schwab 賣出所得（已扣費）
  newCost: number; // 複委託買進成本（含手續費）
  carriedCost: number; // 延續成本 = 原始成本 + (買回成本 − 賣出所得)
}

export interface PendingMigration {
  symbol: string;
  sellDate: string;
  qty: number;
  originalCost: number;
  proceeds: number;
}

export interface LedgerResult {
  anchor?: PositionSnapshot;
  schwab: Record<string, Pool>;
  tw: Record<string, Pool>;
  continuous: Record<string, Pool>;
  realized: RealizedEvent[];
  matches: MigrationMatch[];
  pending: PendingMigration[]; // 已在 Schwab 賣出、尚未在複委託買回
  schwabCash: number;
  twCash: number;
  drip: Record<string, { qty: number; cost: number; count: number }>;
  warnings: string[];
}

const TRADE = new Set(['BUY', 'SELL']);
// 只有交易紀錄類來源會動到現金；投資收益檔的股利與交易紀錄重複，不能再加一次
const CASH_SOURCES = new Set(['schwab-transactions', 'tw-csv', 'manual']);

function pool(m: Record<string, Pool>, s: string): Pool {
  return (m[s] ??= { qty: 0, cost: 0 });
}

function sellFromPool(p: Pool, qty: number): number {
  if (p.qty <= EPS) return 0;
  const q = Math.min(qty, p.qty);
  const cost = (p.cost / p.qty) * q;
  p.qty -= q;
  p.cost -= cost;
  if (p.qty <= EPS) {
    p.qty = 0;
    p.cost = 0;
  }
  return cost;
}

// 延續帳的錨點：遷移開始前最後一份 Schwab 持倉快照（它的成本就是六年累積的原始成本）
export function pickAnchor(store: Store): PositionSnapshot | undefined {
  const from = store.settings.migration.schwabSellFrom;
  const schwab = store.snapshots.filter((s) => s.broker === 'schwab').sort((a, b) => a.date.localeCompare(b.date));
  const before = schwab.filter((s) => s.date < from);
  return before[before.length - 1] ?? schwab[schwab.length - 1];
}

function orderKey(t: Txn): number {
  // 同一天：Schwab 先於複委託，賣出先於買進，讓遷移配對自然成立
  return (t.broker === 'schwab' ? 0 : 2) + (t.type === 'SELL' ? 0 : 1);
}

export function computeLedgers(store: Store, asOf: string): LedgerResult {
  const mig = store.settings.migration;
  const anchor = pickAnchor(store);
  const anchorDate = anchor?.date ?? '0000-00-00';
  const res: LedgerResult = {
    anchor,
    schwab: {},
    tw: {},
    continuous: {},
    realized: [],
    matches: [],
    pending: [],
    schwabCash: anchor?.cash ?? 0,
    twCash: 0,
    drip: {},
    warnings: [],
  };

  // 延續帳依「股票目前在哪家券商」分池：Schwab 賣出只動 Schwab 池（取原始成本），遷移調整只動複委託池
  const contBy: Record<Broker, Record<string, Pool>> = { schwab: {}, tw: {} };
  for (const r of anchor?.rows ?? []) {
    res.schwab[r.symbol] = { qty: r.qty, cost: r.costBasis };
    contBy.schwab[r.symbol] = { qty: r.qty, cost: r.costBasis };
  }

  // 尚未配對的遷移賣出／買進（兩邊誰先發生都可以）
  const openSells: Record<string, PendingMigration[]> = {};
  const openBuys: Record<string, { date: string; qty: number; cost: number }[]> = {};

  const txns = store.txns
    .filter((t) => t.date <= asOf)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || orderKey(a.t) - orderKey(b.t) || a.i - b.i)
    .map((x) => x.t);

  for (const t of txns) {
    const afterAnchor = t.broker === 'tw' || t.date > anchorDate;

    if (t.drip && t.type === 'BUY' && t.symbol && t.qty) {
      const d = (res.drip[t.symbol] ??= { qty: 0, cost: 0, count: 0 });
      d.qty += t.qty;
      d.cost += -t.amount;
      d.count++;
    }

    if (!afterAnchor) continue;
    if (CASH_SOURCES.has(t.source)) {
      if (t.broker === 'schwab') res.schwabCash += t.amount;
      else res.twCash += t.amount;
    }
    if (!TRADE.has(t.type) || !t.symbol || !t.qty) continue;

    const sym = t.symbol;
    const brokerPool = pool(t.broker === 'schwab' ? res.schwab : res.tw, sym);
    const cont = pool(contBy[t.broker], sym);
    const contTw = pool(contBy.tw, sym);

    if (t.type === 'BUY') {
      const cost = -t.amount; // 含手續費
      brokerPool.qty += t.qty;
      brokerPool.cost += cost;
      cont.qty += t.qty;
      cont.cost += cost;
      if (t.broker === 'tw' && inRange(t.date, mig.twBuyFrom, mig.twBuyTo)) {
        matchBuy(res, contTw, openSells, openBuys, { symbol: sym, date: t.date, qty: t.qty, cost });
      }
      continue;
    }

    // SELL
    const proceeds = t.amount;
    if (t.qty > brokerPool.qty + EPS) {
      res.warnings.push(`${t.date} ${t.broker === 'schwab' ? 'Schwab' : '複委託'} 賣出 ${sym} ${t.qty} 股，超過帳上持股 ${round(brokerPool.qty, 4)} 股`);
    }
    const brokerCost = sellFromPool(brokerPool, t.qty);
    res.realized.push({
      ledger: t.broker as Broker,
      date: t.date,
      symbol: sym,
      qty: t.qty,
      proceeds,
      cost: brokerCost,
      gain: proceeds - brokerCost,
    });

    const contCost = sellFromPool(cont, t.qty);
    if (t.broker === 'schwab' && inRange(t.date, mig.schwabSellFrom, mig.schwabSellTo)) {
      matchSell(res, contTw, openSells, openBuys, { symbol: sym, sellDate: t.date, qty: t.qty, originalCost: contCost, proceeds });
    } else {
      res.realized.push({ ledger: 'continuous', date: t.date, symbol: sym, qty: t.qty, proceeds, cost: contCost, gain: proceeds - contCost });
    }
  }

  // 買回期限已過仍未配對的部分（例如碎股沒有買回）→ 延續帳在賣出日實現損益
  const windowClosed = asOf > mig.twBuyTo;
  for (const list of Object.values(openSells)) {
    for (const p of list) {
      if (p.qty <= EPS) continue;
      if (windowClosed) {
        res.realized.push({
          ledger: 'continuous',
          date: p.sellDate,
          symbol: p.symbol,
          qty: p.qty,
          proceeds: p.proceeds,
          cost: p.originalCost,
          gain: p.proceeds - p.originalCost,
          note: '遷移時未買回的部分',
        });
      } else {
        res.pending.push(p);
      }
    }
  }

  for (const b of ['schwab', 'tw'] as const) {
    for (const [sym, p] of Object.entries(contBy[b])) {
      const c = pool(res.continuous, sym);
      c.qty += p.qty;
      c.cost += p.cost;
    }
  }
  for (const m of [res.schwab, res.tw, res.continuous]) {
    for (const [s, p] of Object.entries(m)) if (p.qty <= EPS) delete m[s];
  }
  return res;
}

// 遷移配對的核心：延續成本 = 複委託實際成本 − 遞延損益（賣出所得 − 原始成本），按配對股數比例。
// 平均成本池只需要調整總成本，所以賣出、買回誰先發生結果都一樣。
function applyMatch(
  res: LedgerResult,
  cont: Pool,
  m: { symbol: string; sellDate: string; buyDate: string; qty: number; originalCost: number; proceeds: number; newCost: number },
) {
  const deferred = m.proceeds - m.originalCost;
  cont.cost -= deferred;
  res.matches.push({ ...m, carriedCost: m.newCost - deferred });
}

function matchSell(
  res: LedgerResult,
  cont: Pool,
  openSells: Record<string, PendingMigration[]>,
  openBuys: Record<string, { date: string; qty: number; cost: number }[]>,
  sell: PendingMigration,
) {
  const s = { ...sell };
  for (const b of openBuys[s.symbol] ?? []) {
    if (s.qty <= EPS) break;
    if (b.qty <= EPS) continue;
    const q = Math.min(s.qty, b.qty);
    const fs = q / s.qty;
    const fb = q / b.qty;
    applyMatch(res, cont, {
      symbol: s.symbol,
      sellDate: s.sellDate,
      buyDate: b.date,
      qty: q,
      originalCost: s.originalCost * fs,
      proceeds: s.proceeds * fs,
      newCost: b.cost * fb,
    });
    s.originalCost -= s.originalCost * fs;
    s.proceeds -= s.proceeds * fs;
    s.qty -= q;
    b.cost -= b.cost * fb;
    b.qty -= q;
  }
  if (s.qty > EPS) (openSells[s.symbol] ??= []).push(s);
}

function matchBuy(
  res: LedgerResult,
  cont: Pool,
  openSells: Record<string, PendingMigration[]>,
  openBuys: Record<string, { date: string; qty: number; cost: number }[]>,
  buy: { symbol: string; date: string; qty: number; cost: number },
) {
  const b = { ...buy };
  for (const s of openSells[b.symbol] ?? []) {
    if (b.qty <= EPS) break;
    if (s.qty <= EPS) continue;
    const q = Math.min(s.qty, b.qty);
    const fs = q / s.qty;
    const fb = q / b.qty;
    applyMatch(res, cont, {
      symbol: b.symbol,
      sellDate: s.sellDate,
      buyDate: b.date,
      qty: q,
      originalCost: s.originalCost * fs,
      proceeds: s.proceeds * fs,
      newCost: b.cost * fb,
    });
    s.originalCost -= s.originalCost * fs;
    s.proceeds -= s.proceeds * fs;
    s.qty -= q;
    b.cost -= b.cost * fb;
    b.qty -= q;
  }
  if (b.qty > EPS) (openBuys[b.symbol] ??= []).push(b);
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
