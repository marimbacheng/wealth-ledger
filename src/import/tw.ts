import type { Broker, Txn, TxnType } from '../domain/types';
import { emptyBatch, normalizeSymbol, type ImportBatch } from './batch';
import { parseMoney, parseUsDate } from './csv';

// 台灣複委託沒有統一的匯出格式，所以定義一份範本：從券商 App 複製貼上或手動整理成這個格式即可匯入。
// 券商欄可填 schwab，用來補登 Schwab 匯出檔沒涵蓋到的早年股利或交易。
export const TW_TXN_HEADER = [
  '日期',
  '券商',
  '類別',
  '代號',
  '名稱',
  '股數',
  '價格',
  '手續費',
  '金額',
  '稅前股利',
  '預扣稅',
  '稅後股利',
  '再投入',
  '備註',
] as const;

export const TW_POS_HEADER = ['日期', '代號', '名稱', '股數', '總成本', '現價', '市值'] as const;

const CATEGORY: Record<string, TxnType> = {
  買進: 'BUY',
  買入: 'BUY',
  賣出: 'SELL',
  股利: 'DIV',
  配息: 'DIV',
  入金: 'DEPOSIT',
  出金: 'WITHDRAW',
  轉入: 'TRANSFER_IN',
  轉出: 'TRANSFER_OUT',
  費用: 'FEE',
  利息: 'INTEREST',
};

const YES = /^(y|yes|是|1|true|v)$/i;

function col(h: string[], name: string): number {
  return h.findIndex((x) => x.trim() === name);
}

export function isTwTxnHeader(h: string[]): boolean {
  return col(h, '類別') >= 0 && col(h, '代號') >= 0 && col(h, '日期') >= 0;
}

export function isTwPositionHeader(h: string[]): boolean {
  return col(h, '代號') >= 0 && col(h, '股數') >= 0 && col(h, '總成本') >= 0 && col(h, '類別') < 0;
}

export function parseTwTransactions(rows: string[][], file: string): ImportBatch {
  const b = emptyBatch('tw-transactions', file);
  const h = rows[0];
  const get = (r: string[], name: string) => {
    const i = col(h, name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const num = (r: string[], name: string) => parseMoney(get(r, name));

  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const date = parseUsDate(get(r, '日期'));
    const cat = get(r, '類別');
    const type = CATEGORY[cat];
    if (!date || !type) {
      b.warnings.push(`第 ${line} 列：日期或類別無法辨識（${get(r, '日期')} / ${cat}），略過`);
      return;
    }
    const brokerRaw = get(r, '券商').toLowerCase();
    const broker: Broker = brokerRaw === 'schwab' ? 'schwab' : 'tw';
    const symRaw = get(r, '代號');
    const symbol = symRaw ? normalizeSymbol(symRaw) : undefined;
    const name = get(r, '名稱') || undefined;
    if (symbol && name) b.securities[symbol] = { name };
    const base = {
      broker,
      date,
      symbol,
      description: name,
      source: 'tw-csv',
      note: get(r, '備註') || undefined,
    };

    if (type === 'BUY' || type === 'SELL') {
      const qty = num(r, '股數');
      const price = num(r, '價格');
      const fee = Math.abs(num(r, '手續費') ?? 0);
      const given = num(r, '金額');
      if (!symbol || !qty || (price == null && given == null)) {
        b.warnings.push(`第 ${line} 列：${cat} 需要代號、股數，以及價格或金額，略過`);
        return;
      }
      const gross = price != null ? qty * price : Math.abs(given!) + (type === 'BUY' ? -fee : fee);
      const amount =
        given != null ? (type === 'BUY' ? -Math.abs(given) : Math.abs(given)) : type === 'BUY' ? -(gross + fee) : gross - fee;
      const t: Omit<Txn, 'id'> = {
        ...base,
        type,
        qty: Math.abs(qty),
        price: price ?? gross / qty,
        fee,
        amount: round2(amount),
      };
      if (type === 'BUY' && YES.test(get(r, '再投入'))) t.drip = true;
      b.txns.push(t);
      return;
    }

    if (type === 'DIV') {
      if (!symbol) {
        b.warnings.push(`第 ${line} 列：股利需要代號，略過`);
        return;
      }
      let gross = num(r, '稅前股利');
      let tax = num(r, '預扣稅');
      let net = num(r, '稅後股利');
      if (tax != null) tax = Math.abs(tax);
      if (gross == null && net == null) {
        const amt = num(r, '金額');
        if (amt != null) net = amt;
      }
      if (gross != null && tax == null && net != null) tax = round2(gross - net);
      if (gross == null && tax != null && net != null) gross = round2(net + tax);
      if (gross != null) {
        b.txns.push({ ...base, type: 'DIV', amount: gross, rawAction: '股利（稅前）' });
        if (tax != null && tax !== 0) b.txns.push({ ...base, type: 'TAX', amount: -tax, rawAction: '預扣稅' });
        if (tax == null) b.warnings.push(`第 ${line} 列：${symbol} 只有稅前股利，預扣稅視為 0`);
      } else if (net != null) {
        b.txns.push({ ...base, type: 'DIV', amount: net, netOnly: true, rawAction: '股利（僅稅後）' });
      } else {
        b.warnings.push(`第 ${line} 列：股利沒有金額，略過`);
      }
      return;
    }

    const amt = num(r, '金額');
    if (amt == null) {
      b.warnings.push(`第 ${line} 列：${cat} 需要金額，略過`);
      return;
    }
    const sign = type === 'DEPOSIT' || type === 'TRANSFER_IN' || type === 'INTEREST' ? 1 : -1;
    b.txns.push({ ...base, type, amount: sign * Math.abs(amt), rawAction: cat });
  });

  const dates = b.txns.map((t) => t.date).sort();
  if (dates.length) b.coverage = { broker: 'tw', kind: 'transactions', from: dates[0], to: dates[dates.length - 1] };
  return b;
}

export function parseTwPositions(rows: string[][], file: string): ImportBatch {
  const b = emptyBatch('tw-positions', file);
  const h = rows[0];
  const get = (r: string[], name: string) => {
    const i = col(h, name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  let date: string | undefined;
  const out: NonNullable<ImportBatch['snapshot']> = { broker: 'tw', date: '', rows: [], cash: 0, total: 0, source: file };
  for (const r of rows.slice(1)) {
    const d = parseUsDate(get(r, '日期'));
    if (d && (!date || d > date)) date = d;
    const symRaw = get(r, '代號');
    const qty = parseMoney(get(r, '股數'));
    const cost = parseMoney(get(r, '總成本'));
    if (!symRaw || qty == null || cost == null) continue;
    const symbol = normalizeSymbol(symRaw);
    const price = parseMoney(get(r, '現價')) ?? 0;
    const mv = parseMoney(get(r, '市值')) ?? qty * price;
    out.rows.push({ symbol, name: get(r, '名稱') || symbol, qty, price, costBasis: cost, marketValue: mv });
  }
  if (!date) {
    b.warnings.push('庫存檔缺少日期欄');
    return b;
  }
  out.date = date;
  out.total = out.rows.reduce((s, x) => s + x.marketValue, 0);
  b.snapshot = out;
  return b;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
