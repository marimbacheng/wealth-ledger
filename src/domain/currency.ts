import type { Currency, SecurityMeta, Store, Txn } from './types';

// 台股代號是 4～6 位數字，可能帶一個英文字尾（如 00878、006208、2330、00679B）
export const isTaiwanSymbol = (s?: string) => !!s && /^\d{4,6}[A-Z]?$/.test(s);

export function currencyOf(symbol?: string, meta?: Record<string, SecurityMeta>): Currency {
  const m = symbol ? meta?.[symbol]?.currency : undefined;
  if (m) return m;
  return isTaiwanSymbol(symbol) ? 'TWD' : 'USD';
}

export function txnCurrency(t: Txn, meta?: Record<string, SecurityMeta>): Currency {
  return t.currency ?? currencyOf(t.symbol, meta);
}

export function currentRate(store: Pick<Store, 'fx'>): number | undefined {
  if (store.fx?.current?.rate) return store.fx.current.rate;
  const dates = Object.keys(store.fx?.history ?? {}).sort();
  return dates.length ? store.fx.history[dates[dates.length - 1]] : undefined;
}

// 指定日期的匯率：當天 → 之前最近一天 → 目前匯率
export function rateAt(store: Pick<Store, 'fx'>, date: string): number | undefined {
  const h = store.fx?.history ?? {};
  if (h[date]) return h[date];
  const before = Object.keys(h)
    .filter((d) => d <= date)
    .sort();
  return before.length ? h[before[before.length - 1]] : currentRate(store);
}

// 換成美元；台幣沒有匯率時回傳 undefined，由呼叫端決定怎麼處理
export function toUSD(amount: number, cur: Currency, rate: number | undefined): number | undefined {
  if (cur === 'USD') return amount;
  return rate ? amount / rate : undefined;
}

export function convert(amount: number, from: Currency, to: Currency, rate: number | undefined): number | undefined {
  if (from === to) return amount;
  if (!rate) return undefined;
  return from === 'USD' ? amount * rate : amount / rate;
}
