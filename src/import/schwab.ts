import type { Txn, TxnType } from '../domain/types';
import { emptyBatch, normalizeSymbol, type ImportBatch } from './batch';
import { parseMoney, parseUsDate } from './csv';

type Row = string[];

// 先找完全相同的欄名，再找前綴（避免 "Proceeds" 誤配到 "Proceeds Per Share"）
function headerIndex(header: Row, ...names: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  for (const p of names) {
    const i = norm.indexOf(p.toLowerCase());
    if (i >= 0) return i;
  }
  for (const p of names) {
    const i = norm.findIndex((h) => h.startsWith(p.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

function minMax(dates: string[]): { from: string; to: string } | undefined {
  if (dates.length === 0) return undefined;
  const s = [...dates].sort();
  return { from: s[0], to: s[s.length - 1] };
}

// ---------- 持倉 ----------
export function parsePositions(rows: Row[], file: string): ImportBatch {
  const b = emptyBatch('schwab-positions', file);
  const dm = rows[0]?.[0]?.match(/(\d{4}\/\d{1,2}\/\d{1,2})/);
  const date = dm ? parseUsDate(dm[1]) : undefined;
  if (!date) {
    b.warnings.push('找不到持倉日期');
    return b;
  }
  const hi = rows.findIndex((r) => r[0]?.trim() === 'Symbol');
  const h = rows[hi];
  const ix = {
    sym: 0,
    desc: headerIndex(h, 'Description'),
    qty: headerIndex(h, 'Qty', 'Quantity'),
    price: headerIndex(h, 'Price'),
    cost: headerIndex(h, 'Cost Basis'),
    mv: headerIndex(h, 'Mkt Val', 'Market Value'),
    lastDiv: headerIndex(h, 'Last Div'),
    type: headerIndex(h, 'Asset Type'),
  };
  const out: NonNullable<ImportBatch['snapshot']> = {
    broker: 'schwab',
    date,
    rows: [],
    cash: 0,
    total: 0,
    source: file,
  };
  for (const r of rows.slice(hi + 1)) {
    const sym = r[0]?.trim();
    if (!sym) continue;
    if (sym.startsWith('Cash')) {
      out.cash = parseMoney(r[ix.mv]) ?? 0;
      continue;
    }
    if (sym === 'Positions Total' || sym === 'Account Total') continue;
    const symbol = normalizeSymbol(sym);
    const qty = parseMoney(r[ix.qty]);
    if (qty == null) {
      b.warnings.push(`${sym} 沒有股數，略過`);
      continue;
    }
    const price = parseMoney(r[ix.price]) ?? 0;
    const mv = parseMoney(r[ix.mv]) ?? qty * price;
    const cost = parseMoney(r[ix.cost]);
    if (cost == null) b.warnings.push(`${symbol} 沒有成本資料（Cost Basis 為 --），以 0 計`);
    out.rows.push({
      symbol,
      name: r[ix.desc]?.trim() ?? symbol,
      qty,
      price,
      costBasis: cost ?? 0,
      marketValue: mv,
      lastDiv: parseMoney(r[ix.lastDiv]),
      assetType: r[ix.type]?.trim(),
    });
    b.securities[symbol] = { name: r[ix.desc]?.trim() };
  }
  out.total = out.cash + out.rows.reduce((s, x) => s + x.marketValue, 0);
  b.snapshot = out;
  b.valuePoint = { date, value: out.total, source: 'snapshot', note: 'Schwab 持倉匯出' };
  return b;
}

// ---------- 帳戶餘額 ----------
export function parseBalances(rows: Row[], file: string): ImportBatch {
  const b = emptyBatch('schwab-balances', file);
  const dm = rows[0]?.[0]?.match(/as of (\d{1,2}\/\d{1,2}\/\d{4})/);
  const date = dm ? parseUsDate(dm[1]) : undefined;
  const av = rows.find((r) => r[0]?.trim() === 'Account Value');
  const value = parseMoney(av?.[1]);
  if (!date || value == null) {
    b.warnings.push('找不到帳戶總值或日期');
    return b;
  }
  b.valuePoint = { date, value, source: 'balances', note: 'Schwab 帳戶餘額匯出' };
  return b;
}

// ---------- 交易紀錄 ----------
const DIV_ACTIONS = /div|dividend|cap gain|capital gain/i;
const TAX_ACTIONS = /nra tax|foreign tax|withholding|nra withhold/i;

// note：已知的特殊列，記成「其他」但不需要提醒使用者
export function classifySchwabAction(
  action: string,
  amount: number,
  desc = '',
  hasQty = false,
): { type: TxnType; drip?: boolean; note?: string } {
  const a = action.trim();
  if (a === 'Buy' || a === 'Buy to Open') return { type: 'BUY' };
  if (a === 'Sell' || a === 'Sell to Close') return { type: 'SELL' };
  if (a === 'Reinvest Shares') return { type: 'BUY', drip: true };
  // 再投入更正：金額為正 = 撤銷先前的再投入（股數減少、現金退回）
  if (a === 'Reinvestment Adj') return amount > 0 ? { type: 'SELL', drip: true, note: '再投入更正（撤銷）' } : { type: 'BUY', drip: true, note: '再投入更正' };
  // TD Ameritrade 轉入 Schwab 的歷史格式
  if (a === 'Journaled Shares') {
    if (/WITHHOLDING/i.test(desc)) return { type: 'TAX' };
    if (/TRANSFER OF SECURITY/i.test(desc)) return { type: 'OTHER', note: '券商轉換：證券轉出（TD Ameritrade → Schwab）' };
    if (/SPIN OFF/i.test(desc)) return { type: 'OTHER', note: '分拆配股' };
    if (/CASH MOVEMENT OF OUTGOING ACCOUNT TRANSFER/i.test(desc)) return { type: amount >= 0 ? 'TRANSFER_IN' : 'TRANSFER_OUT', note: '券商轉換：現金移轉' };
    return { type: 'OTHER' };
  }
  if (a === 'Internal Transfer') {
    if (hasQty) return { type: 'OTHER', note: '券商轉換：證券轉入（TD Ameritrade → Schwab）' };
    return { type: amount >= 0 ? 'TRANSFER_IN' : 'TRANSFER_OUT', note: '券商轉換：現金移轉' };
  }
  if (a === 'Cash In Lieu') return { type: 'OTHER', note: '零股折現（公司行動）' };
  if (TAX_ACTIONS.test(a)) return { type: 'TAX' };
  if (DIV_ACTIONS.test(a)) return { type: 'DIV' };
  if (/interest/i.test(a)) return { type: 'INTEREST' };
  if (/fee|adr mgmt/i.test(a)) return { type: 'FEE' };
  if (/wire|moneylink|journal|funds|deposit|transfer/i.test(a)) {
    return { type: amount >= 0 ? 'DEPOSIT' : 'WITHDRAW' };
  }
  return { type: 'OTHER' };
}

export function parseTransactions(rows: Row[], file: string): ImportBatch {
  const b = emptyBatch('schwab-transactions', file);
  const h = rows[0];
  const ix = {
    date: headerIndex(h, 'Date'),
    action: headerIndex(h, 'Action'),
    sym: headerIndex(h, 'Symbol'),
    desc: headerIndex(h, 'Description'),
    qty: headerIndex(h, 'Quantity'),
    price: headerIndex(h, 'Price'),
    fee: headerIndex(h, 'Fees'),
    amount: headerIndex(h, 'Amount'),
  };
  const dates: string[] = [];
  for (const r of rows.slice(1)) {
    // Schwab 的日期可能是 "10/15/2026 as of 10/14/2026"，取前者（交易處理日）
    const date = parseUsDate(r[ix.date] ?? '');
    if (!date) continue;
    dates.push(date);
    const action = r[ix.action]?.trim() ?? '';
    const amount = parseMoney(r[ix.amount]) ?? 0;
    const desc = r[ix.desc]?.trim() ?? '';
    const qtyRaw = parseMoney(r[ix.qty]);
    const { type, drip, note } = classifySchwabAction(action, amount, desc, qtyRaw != null && qtyRaw !== 0);
    // TD Ameritrade 時期的股利、預扣稅常沒有填代號，代號在說明最後的括號裡，例如 "QUALIFIED DIVIDEND (CMCSA)"
    const symRaw = r[ix.sym]?.trim() || (desc.match(/\(([A-Z][A-Z0-9 ./-]{0,9})\)\s*$/)?.[1] ?? '');
    const t: Omit<Txn, 'id'> = {
      broker: 'schwab',
      date,
      type,
      symbol: symRaw ? normalizeSymbol(symRaw) : undefined,
      description: r[ix.desc]?.trim(),
      qty: qtyRaw != null ? Math.abs(qtyRaw) : undefined,
      price: parseMoney(r[ix.price]),
      fee: parseMoney(r[ix.fee]) != null ? Math.abs(parseMoney(r[ix.fee])!) : undefined,
      amount,
      rawAction: action,
      source: 'schwab-transactions',
    };
    if (drip) t.drip = true;
    if (note) t.note = note;
    if (type === 'OTHER' && !note) b.warnings.push(`${date} 未辨識的動作「${action}」${symRaw}，以「其他」記錄，不影響持倉`);
    if (type === 'SELL' || type === 'BUY') {
      if (!t.qty) b.warnings.push(`${date} ${action} ${symRaw} 沒有股數`);
    }
    b.txns.push(t);
  }
  const mm = minMax(dates);
  if (mm) b.coverage = { broker: 'schwab', kind: 'transactions', ...mm };
  return b;
}

// ---------- 投資收益（股利、預估） ----------
export function parseInvestmentIncome(rows: Row[], file: string): ImportBatch {
  const b = emptyBatch('schwab-income', file);
  const dm = rows[0]?.[0]?.match(/as of (\d{1,2}\/\d{1,2}\/\d{4})/);
  const asOf = dm ? parseUsDate(dm[1]) : undefined;
  const hi = rows.findIndex((r) => r[0]?.trim() === 'Transaction Date');
  const h = rows[hi];
  const ix = {
    date: headerIndex(h, 'Transaction Date'),
    desc: headerIndex(h, 'Security Description'),
    sym: headerIndex(h, 'Symbol'),
    ttype: headerIndex(h, 'Transaction Type'),
    amount: headerIndex(h, 'Transaction Amount'),
    income: headerIndex(h, 'Income Type'),
  };
  const received: string[] = [];
  const est: { symbol: string; date: string; amount: number }[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseUsDate(r[ix.date] ?? '');
    const amount = parseMoney(r[ix.amount]);
    if (!date || amount == null) continue;
    const symRaw = r[ix.sym]?.trim() ?? '';
    const ttype = r[ix.ttype]?.trim() ?? '';
    const incomeType = r[ix.income]?.trim() ?? '';
    const isInterest = /interest/i.test(ttype) || symRaw === 'NO NUMBER';
    const symbol = symRaw && symRaw !== 'NO NUMBER' ? normalizeSymbol(symRaw) : undefined;
    if (symbol) b.securities[symbol] = { name: r[ix.desc]?.trim() };
    if (incomeType === 'Estimated') {
      if (!isInterest && symbol) est.push({ symbol, date, amount });
      continue;
    }
    if (incomeType !== 'Received') continue;
    received.push(date);
    b.txns.push({
      broker: 'schwab',
      date,
      type: isInterest ? 'INTEREST' : 'DIV',
      symbol,
      description: r[ix.desc]?.trim(),
      amount,
      rawAction: ttype,
      source: 'schwab-income',
    });
  }
  const mm = minMax(received);
  if (mm) b.coverage = { broker: 'schwab', kind: 'income', from: mm.from, to: asOf ?? mm.to };
  if (est.length > 0) b.estimates = { broker: 'schwab', importedAt: asOf ?? mm?.to ?? '', rows: est };
  return b;
}

// ---------- 已實現損益 ----------
function parseRealizedRange(title: string): { from: string; to: string } | undefined {
  const m = title.match(/(\d{1,2}\/\d{1,2}\/\d{4}) to (\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!m) return undefined;
  const from = parseUsDate(m[1]);
  const to = parseUsDate(m[2]);
  return from && to ? { from, to } : undefined;
}

export function parseRealizedSummary(rows: Row[], file: string): ImportBatch {
  const b = emptyBatch('schwab-realized', file);
  const range = parseRealizedRange(rows[0]?.[0] ?? '');
  const h = rows[1];
  const ix = {
    sym: headerIndex(h, 'Symbol'),
    name: headerIndex(h, 'Name'),
    closed: headerIndex(h, 'Closed Date'),
    qty: headerIndex(h, 'Quantity'),
    proceeds: headerIndex(h, 'Proceeds'),
    cost: headerIndex(h, 'Cost Basis (CB)', 'Cost Basis'),
    gain: headerIndex(h, 'Total Gain/Loss ($)'),
  };
  for (const r of rows.slice(2)) {
    const sym = r[ix.sym]?.trim();
    if (!sym || sym === 'Total') continue;
    const closedDate = parseUsDate(r[ix.closed] ?? '');
    const proceeds = parseMoney(r[ix.proceeds]);
    const cost = parseMoney(r[ix.cost]);
    if (!closedDate || proceeds == null || cost == null) {
      b.warnings.push(`${sym} 已實現資料不完整，略過`);
      continue;
    }
    b.realized.push({
      broker: 'schwab',
      closedDate,
      symbol: normalizeSymbol(sym),
      name: r[ix.name]?.trim(),
      qty: parseMoney(r[ix.qty]) ?? 0,
      proceeds,
      costBasis: cost,
      gain: parseMoney(r[ix.gain]) ?? proceeds - cost,
      source: 'schwab-realized',
    });
  }
  if (range) b.coverage = { broker: 'schwab', kind: 'realized', ...range };
  return b;
}

// 逐批明細：彙總成「同代號、同賣出日」一筆，與彙總檔重複時由合併邏輯去重
export function parseRealizedDetails(rows: Row[], file: string): ImportBatch {
  const b = emptyBatch('schwab-realized-details', file);
  const range = parseRealizedRange(rows[0]?.[0] ?? '');
  const h = rows[1];
  const ix = {
    sym: headerIndex(h, 'Symbol'),
    name: headerIndex(h, 'Name'),
    closed: headerIndex(h, 'Closed Date'),
    qty: headerIndex(h, 'Quantity'),
    proceeds: headerIndex(h, 'Proceeds'),
    cost: headerIndex(h, 'Cost Basis (CB)', 'Cost Basis'),
    gain: headerIndex(h, 'Gain/Loss ($)'),
  };
  const agg = new Map<string, Omit<import('../domain/types').RealizedRecord, 'id'>>();
  for (const r of rows.slice(2)) {
    const sym = r[ix.sym]?.trim();
    const closedDate = parseUsDate(r[ix.closed] ?? '');
    const proceeds = parseMoney(r[ix.proceeds]);
    const cost = parseMoney(r[ix.cost]);
    if (!sym || sym === 'Total' || !closedDate || proceeds == null || cost == null) continue;
    const symbol = normalizeSymbol(sym);
    const key = `${symbol}|${closedDate}`;
    const cur = agg.get(key) ?? {
      broker: 'schwab' as const,
      closedDate,
      symbol,
      name: r[ix.name]?.trim(),
      qty: 0,
      proceeds: 0,
      costBasis: 0,
      gain: 0,
      source: 'schwab-realized-details',
    };
    cur.qty += parseMoney(r[ix.qty]) ?? 0;
    cur.proceeds += proceeds;
    cur.costBasis += cost;
    cur.gain += parseMoney(r[ix.gain]) ?? proceeds - cost;
    agg.set(key, cur);
  }
  b.realized = [...agg.values()].map((x) => ({
    ...x,
    qty: round(x.qty, 4),
    proceeds: round(x.proceeds, 2),
    costBasis: round(x.costBasis, 2),
    gain: round(x.gain, 2),
  }));
  if (range) b.coverage = { broker: 'schwab', kind: 'realized', ...range };
  return b;
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
