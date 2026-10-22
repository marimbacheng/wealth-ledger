import { rateAt, txnCurrency } from '../domain/currency';
import type { Broker, Currency, PositionSnapshot, Store, SymbolMapping, Txn } from '../domain/types';
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
  currency: Currency;
  note?: string;
}

// 遷移配對：Schwab 賣出 ↔ 永豐買回（可以是不同代號，例如 TSM → 2330）。金額都以「買回那檔」的幣別表示
export interface MigrationMatch {
  symbol: string; // 買回的代號
  fromSymbol: string; // Schwab 賣出的代號
  sellDate: string;
  buyDate: string;
  qty: number; // 買回的股數
  sellQty: number; // 對應的 Schwab 賣出股數
  originalCost: number; // 這些股數在 Schwab 的原始成本
  proceeds: number; // Schwab 賣出所得（已扣費）
  newCost: number; // 永豐買進成本（含手續費）
  carriedCost: number; // 延續成本 = 原始成本 + (買回成本 − 賣出所得)
  currency: Currency;
  fx?: number; // 跨幣別時使用的匯率（1 美元兌台幣）
}

export interface PendingMigration {
  symbol: string;
  sellDate: string;
  qty: number;
  originalCost: number;
  proceeds: number;
  currency: Currency;
}

interface OpenBuy {
  symbol: string;
  date: string;
  qty: number;
  cost: number;
  currency: Currency;
  fx?: number;
}

export interface LedgerResult {
  anchor?: PositionSnapshot;
  // 錨點是第一筆遷移賣出當天、賣出前匯出的快照：當天的遷移賣出（與其已實現報表）在錨點之後
  anchorPreSale: boolean;
  schwab: Record<string, Pool>;
  tw: Record<string, Pool>;
  continuous: Record<string, Pool>;
  realized: RealizedEvent[];
  matches: MigrationMatch[];
  pending: PendingMigration[]; // 已在 Schwab 賣出、尚未在永豐買回
  schwabCash: number; // USD
  twCash: number; // 永豐美元
  twCashTWD: number; // 永豐台幣
  drip: Record<string, { qty: number; cost: number; count: number }>;
  warnings: string[];
}

const TRADE = new Set(['BUY', 'SELL', 'OPEN']);
// 只有交易紀錄類來源會動到現金；投資收益檔的股利與交易紀錄重複，不能再加一次
const CASH_SOURCES = new Set(['schwab-transactions', 'tw-csv', 'sinopac-statement', 'manual']);

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
// 延續帳的錨點：第一筆「遷移賣出」之前的最後一份 Schwab 持倉快照。
// 用實際賣出日而不是遷移區間起日：區間可以提早開始（涵蓋先匯出的款項），錨點仍會是最新的賣出前快照。
// 這也避開「快照當天稍晚又有交易」的問題：只要賣出前一天再匯出一次持倉，就以那份為準。
// 賣出當天的快照若仍持有當天賣出的全部股數，表示是賣出前匯出的（例如中午匯出、收盤前賣），也可以當錨點；
// 這時當天的遷移賣出接在快照之後重播，當天其他 Schwab 交易視為已反映在快照裡。
function migrationSells(store: Store): Txn[] {
  const m = store.settings.migration;
  return store.txns.filter((t) => t.broker === 'schwab' && t.type === 'SELL' && inRange(t.date, m.schwabSellFrom, m.schwabSellTo));
}

function holdsAllSold(s: PositionSnapshot, sells: Txn[]): boolean {
  const sold = new Map<string, number>();
  for (const t of sells) if (t.symbol) sold.set(t.symbol, (sold.get(t.symbol) ?? 0) + (t.qty ?? 0));
  return [...sold].every(([sym, q]) => (s.rows.find((r) => r.symbol === sym)?.qty ?? 0) >= q - 1e-3);
}

export function pickAnchor(store: Store): PositionSnapshot | undefined {
  const sells = migrationSells(store);
  const first = sells.map((t) => t.date).sort()[0];
  const schwab = store.snapshots.filter((s) => s.broker === 'schwab').sort((a, b) => a.date.localeCompare(b.date));
  const firstDay = sells.filter((t) => t.date === first);
  const before = first ? schwab.filter((s) => s.date < first || (s.date === first && holdsAllSold(s, firstDay))) : schwab;
  return before[before.length - 1] ?? schwab[0];
}

function orderKey(t: Txn): number {
  // 同一天：Schwab 先於複委託，賣出先於買進，讓遷移配對自然成立
  return (t.broker === 'schwab' ? 0 : 2) + (t.type === 'SELL' ? 0 : 1);
}

export function computeLedgers(store: Store, asOf: string): LedgerResult {
  const mig = store.settings.migration;
  const mappings: SymbolMapping[] = mig.mappings ?? [];
  const anchor = pickAnchor(store);
  const anchorDate = anchor?.date ?? '0000-00-00';
  const res: LedgerResult = {
    anchor,
    anchorPreSale: false,
    schwab: {},
    tw: {},
    continuous: {},
    realized: [],
    matches: [],
    pending: [],
    schwabCash: anchor?.cash ?? 0,
    twCash: 0,
    twCashTWD: 0,
    drip: {},
    warnings: [],
  };
  const cur = (t: Txn) => txnCurrency(t, store.securities);
  const rateFor = (date: string, fx?: number) => fx ?? rateAt(store, date);

  // 延續帳依「股票目前在哪家券商」分池：Schwab 賣出只動 Schwab 池（取原始成本），遷移調整只動永豐池
  const contBy: Record<Broker, Record<string, Pool>> = { schwab: {}, tw: {} };
  for (const r of anchor?.rows ?? []) {
    res.schwab[r.symbol] = { qty: r.qty, cost: r.costBasis };
    contBy.schwab[r.symbol] = { qty: r.qty, cost: r.costBasis };
  }

  // 尚未配對的遷移賣出／買進（兩邊誰先發生都可以）
  const openSells: Record<string, PendingMigration[]> = {};
  const openBuys: Record<string, OpenBuy[]> = {};
  const warned = new Set<string>();

  // 配對一筆賣出與一筆買進。ratio = 每 1 股賣出對應幾股買回；幣別不同時，遞延損益用買進當天匯率換成買回幣別
  const pairUp = (s: PendingMigration, b: OpenBuy, ratio: number) => {
    let k = 1;
    let fx: number | undefined;
    if (s.currency !== b.currency) {
      fx = rateFor(b.date, b.fx);
      if (!fx) {
        const w = `缺少 ${b.date} 的美元／台幣匯率，${s.symbol} 的成本暫時無法接到 ${b.symbol}`;
        if (!warned.has(w)) res.warnings.push(w);
        warned.add(w);
        return;
      }
      k = s.currency === 'USD' ? fx : 1 / fx;
    }
    const qBuy = Math.min(b.qty, s.qty * ratio);
    if (qBuy <= EPS) return;
    const qSell = qBuy / ratio;
    const fs = qSell / s.qty;
    const fb = qBuy / b.qty;
    const originalCost = s.originalCost * fs;
    const proceeds = s.proceeds * fs;
    const newCost = b.cost * fb;
    const deferred = (proceeds - originalCost) * k;
    pool(contBy.tw, b.symbol).cost -= deferred;
    res.matches.push({
      symbol: b.symbol,
      fromSymbol: s.symbol,
      sellDate: s.sellDate,
      buyDate: b.date,
      qty: qBuy,
      sellQty: qSell,
      originalCost: originalCost * k,
      proceeds: proceeds * k,
      newCost,
      carriedCost: newCost - deferred,
      currency: b.currency,
      ...(fx ? { fx } : {}),
    });
    s.originalCost -= originalCost;
    s.proceeds -= proceeds;
    s.qty -= qSell;
    b.cost -= newCost;
    b.qty -= qBuy;
  };

  const matchBuy = (b: OpenBuy) => {
    const sources = [{ symbol: b.symbol, ratio: 1 }, ...mappings.filter((m) => m.to === b.symbol).map((m) => ({ symbol: m.from, ratio: m.ratio }))];
    for (const src of sources) {
      for (const s of openSells[src.symbol] ?? []) {
        if (b.qty <= EPS) break;
        if (s.qty > EPS) pairUp(s, b, src.ratio);
      }
    }
    if (b.qty > EPS) (openBuys[b.symbol] ??= []).push(b);
  };

  const matchSell = (s: PendingMigration) => {
    const targets = [{ symbol: s.symbol, ratio: 1 }, ...mappings.filter((m) => m.from === s.symbol).map((m) => ({ symbol: m.to, ratio: m.ratio }))];
    for (const tgt of targets) {
      for (const b of openBuys[tgt.symbol] ?? []) {
        if (s.qty <= EPS) break;
        if (b.qty > EPS) pairUp(s, b, tgt.ratio);
      }
    }
    if (s.qty > EPS) (openSells[s.symbol] ??= []).push(s);
  };

  const txns = store.txns
    .filter((t) => t.date <= asOf)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || orderKey(a.t) - orderKey(b.t) || a.i - b.i)
    .map((x) => x.t);

  // 錨點是賣出當天、賣出前的快照時，當天的遷移賣出還沒反映在快照裡
  const sells = migrationSells(store);
  res.anchorPreSale = !!anchor && sells.map((x) => x.date).sort()[0] === anchorDate;
  const sameDaySells = new Set(res.anchorPreSale ? sells.filter((x) => x.date === anchorDate) : []);

  for (const t of txns) {
    const afterAnchor = t.broker === 'tw' || t.date > anchorDate || sameDaySells.has(t);

    if (t.drip && t.symbol && t.qty) {
      const d = (res.drip[t.symbol] ??= { qty: 0, cost: 0, count: 0 });
      if (t.type === 'BUY') {
        d.qty += t.qty;
        d.cost += -t.amount;
        d.count++;
      } else if (t.type === 'SELL') {
        // 再投入撤銷：扣回股數與金額，之後通常會有一筆更正後的再投入
        d.qty -= t.qty;
        d.cost -= t.amount;
        d.count--;
      }
    }

    if (!afterAnchor) continue;
    // 期初持股沒有現金流；其他交易依券商與幣別累計現金
    if (CASH_SOURCES.has(t.source) && t.type !== 'OPEN') {
      if (t.broker === 'schwab') res.schwabCash += t.amount;
      else if (cur(t) === 'TWD') res.twCashTWD += t.amount;
      else res.twCash += t.amount;
    }
    if (!TRADE.has(t.type) || !t.symbol || !t.qty) continue;

    const sym = t.symbol;
    const brokerPool = pool(t.broker === 'schwab' ? res.schwab : res.tw, sym);
    const cont = pool(contBy[t.broker], sym);

    if (t.type === 'OPEN') {
      const cost = Math.abs(t.amount);
      brokerPool.qty += t.qty;
      brokerPool.cost += cost;
      cont.qty += t.qty;
      cont.cost += cost;
      continue;
    }

    if (t.type === 'BUY') {
      const cost = -t.amount; // 含手續費
      brokerPool.qty += t.qty;
      brokerPool.cost += cost;
      cont.qty += t.qty;
      cont.cost += cost;
      if (t.broker === 'tw' && inRange(t.date, mig.twBuyFrom, mig.twBuyTo)) {
        matchBuy({ symbol: sym, date: t.date, qty: t.qty, cost, currency: cur(t), fx: t.fx });
      }
      continue;
    }

    // SELL
    const proceeds = t.amount;
    if (t.qty > brokerPool.qty + EPS) {
      res.warnings.push(`${t.date} ${t.broker === 'schwab' ? 'Schwab' : '永豐'} 賣出 ${sym} ${t.qty} 股，超過帳上持股 ${round(brokerPool.qty, 4)} 股`);
    }
    const brokerCost = sellFromPool(brokerPool, t.qty);
    res.realized.push({ ledger: t.broker as Broker, date: t.date, symbol: sym, qty: t.qty, proceeds, cost: brokerCost, gain: proceeds - brokerCost, currency: cur(t) });

    const contCost = sellFromPool(cont, t.qty);
    if (t.broker === 'schwab' && inRange(t.date, mig.schwabSellFrom, mig.schwabSellTo)) {
      matchSell({ symbol: sym, sellDate: t.date, qty: t.qty, originalCost: contCost, proceeds, currency: cur(t) });
    } else {
      res.realized.push({ ledger: 'continuous', date: t.date, symbol: sym, qty: t.qty, proceeds, cost: contCost, gain: proceeds - contCost, currency: cur(t) });
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
          currency: p.currency,
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

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
