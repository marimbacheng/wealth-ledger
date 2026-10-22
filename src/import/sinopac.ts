import type { Currency, Txn } from '../domain/types';
import { emptyBatch, normalizeSymbol, type ImportBatch } from './batch';
import { parseMoney, parseUsDate } from './csv';

// 永豐大戶投複委託「對帳單」下載檔（.xlsx，或另存的 CSV）。
// 一列一筆成交：成交日、市場（代號.市場）、買賣 B/S、成交量、成交均價、成交價金、各項費用、淨收付、交割日、計價幣別。
const FEE_COLS = ['手續費', '交易稅', '印花稅', '交所稅', '匯費', '管理費', '服務費', '交易徵費'];

function col(h: string[], name: string): number {
  return h.findIndex((x) => x.trim() === name);
}

export function isSinopacStatementHeader(h: string[]): boolean {
  return ['成交日', '市場', '買賣', '淨收付'].every((n) => col(h, n) >= 0);
}

// 20261021 或 2026/10/21
function parseDate(v: string): string | undefined {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : parseUsDate(v);
}

// AAPL.US → AAPL；BRK.B.US → BRK.B（只去掉最後的兩碼市場代碼）
function symbolOf(market: string): string {
  return normalizeSymbol(market.trim().replace(/\.[A-Z]{2}$/i, ''));
}

const SIDE: Record<string, 'BUY' | 'SELL'> = { B: 'BUY', 買: 'BUY', 買進: 'BUY', S: 'SELL', 賣: 'SELL', 賣出: 'SELL' };

export function parseSinopacStatement(rows: string[][], file: string): ImportBatch {
  const b = emptyBatch('tw-statement', file);
  const h = rows[0];
  const get = (r: string[], name: string) => {
    const i = col(h, name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const num = (r: string[], name: string) => parseMoney(get(r, name));

  rows.slice(1).forEach((r, n) => {
    if (r.every((c) => !c?.trim())) return;
    const line = n + 2;
    const date = parseDate(get(r, '成交日'));
    const side = SIDE[get(r, '買賣')];
    const market = get(r, '市場');
    const qty = num(r, '成交量');
    const net = num(r, '淨收付');
    if (!date || !side || !market || !qty || net == null) {
      b.warnings.push(`第 ${line} 列：成交日、買賣（${get(r, '買賣') || '空白'}）、市場、成交量或淨收付無法辨識，略過`);
      return;
    }
    const cur = get(r, '計價幣別').toUpperCase();
    if (cur && cur !== 'USD' && cur !== 'TWD') {
      b.warnings.push(`第 ${line} 列：${market} 以 ${cur} 計價，目前只支援美元與台幣，略過`);
      return;
    }
    const symbol = symbolOf(market);
    const gross = num(r, '成交價金');
    const price = num(r, '成交均價') ?? (gross != null ? gross / qty : Math.abs(net) / qty);
    const fee = Math.round(FEE_COLS.reduce((a, c) => a + Math.abs(num(r, c) ?? 0), 0) * 100) / 100;
    // 淨收付 = 成交價金 ∓ 各項費用；對不起來時提醒，但以券商的淨收付為準
    if (gross != null && Math.abs(Math.abs(net) - (side === 'BUY' ? gross + fee : gross - fee)) > 0.011) {
      b.warnings.push(`第 ${line} 列：${symbol} 淨收付 ${net} 與成交價金 ${gross}、費用 ${fee} 對不起來，以淨收付為準`);
    }
    const name = get(r, '商品');
    if (name) b.securities[symbol] = { name };
    const settle = parseDate(get(r, '交割日'));
    const t: Omit<Txn, 'id'> = {
      broker: 'tw',
      date,
      type: side,
      symbol,
      description: name || undefined,
      qty,
      price,
      fee,
      amount: side === 'BUY' ? -Math.abs(net) : Math.abs(net),
      source: 'sinopac-statement',
      rawAction: side === 'BUY' ? '買進' : '賣出',
      ...(cur ? { currency: cur as Currency } : {}),
      ...(settle ? { note: `交割日 ${settle}` } : {}),
    };
    b.txns.push(t);
  });

  const dates = b.txns.map((t) => t.date).sort();
  if (dates.length) b.coverage = { broker: 'tw', kind: 'transactions', from: dates[0], to: dates[dates.length - 1] };
  return b;
}
