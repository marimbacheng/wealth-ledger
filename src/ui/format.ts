import type { Currency } from '../domain/types';

const FMT: Record<Currency, { normal: Intl.NumberFormat; whole: Intl.NumberFormat }> = {
  USD: {
    normal: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    whole: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  },
  TWD: {
    normal: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    whole: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }),
  },
};

// 顯示幣別：報表金額一律是美元，切到台幣時用目前匯率換算。App 每次 render 前設定一次。
let display: { cur: Currency; rate: number } = { cur: 'USD', rate: 1 };
export function setDisplay(cur: Currency, rate: number | undefined) {
  display = cur === 'TWD' && rate ? { cur, rate } : { cur: 'USD', rate: 1 };
}
export const displayCurrency = () => display.cur;
export const displayRate = () => display.rate;

function fmt(n: number | undefined, cur: Currency, opts: { sign?: boolean; whole?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const s = (opts.whole || (cur === 'TWD' && Math.abs(v) >= 1000) ? FMT[cur].whole : FMT[cur].normal).format(v);
  return opts.sign && v > 0 ? `+${s}` : s;
}

// 報表金額（美元）→ 依目前顯示幣別
export function money(n: number | undefined, opts: { sign?: boolean; whole?: boolean } = {}): string {
  return fmt(n == null ? n : n * display.rate, display.cur, opts);
}

// 原幣別金額（每股價格、單筆交易），不換算
export function moneyIn(n: number | undefined, cur: Currency, opts: { sign?: boolean; whole?: boolean } = {}): string {
  return fmt(n, cur, opts);
}

// 圖表座標軸用的簡寫（$12k／NT$380k）
export function compactMoney(n: number): string {
  const v = n * display.rate;
  const sym = display.cur === 'TWD' ? 'NT$' : '$';
  return Math.abs(v) >= 1000 ? `${sym}${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : `${sym}${v.toFixed(0)}`;
}

export function pct(n: number | undefined, digits = 2, sign = false): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = `${(n * 100).toFixed(digits)}%`;
  return sign && n > 0 ? `+${s}` : s;
}

export function qty(n: number | undefined): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export function tone(n: number | undefined): string {
  if (n == null || Math.abs(n) < 0.005) return '';
  return n > 0 ? 'up' : 'down';
}

export function today(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
