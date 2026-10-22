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

// 圖表座標軸用的簡寫：美元用 k（$12k），台幣用萬，寫成 w（162.4w）
export function compactMoney(n: number): string {
  const v = n * display.rate;
  const a = Math.abs(v);
  if (display.cur === 'TWD') return a >= 1e4 ? `${(v / 1e4).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}w` : v.toFixed(0);
  return a >= 1000 ? `$${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `$${v.toFixed(0)}`;
}

// 數值軸：在「顯示幣別」下取整齊的刻度（$44k、$46k…／140w、150w…），回傳報表用的美元值。
// 範圍約為最小值的 90% 到最大值的 105%，讓線落在中上方。
export function niceAxis(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  const r = display.rate;
  const lo0 = Math.min(min * 0.9, min) * r;
  const hi0 = Math.max(max * 1.05, max) * r;
  const raw = Math.max((hi0 - lo0) / 4, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v / r);
  return { domain: [lo / r, hi / r], ticks };
}

// 時間軸以年為單位：每年 1 月 1 日一個刻度；範圍內沒有跨年時，只在起點標年份
export function yearTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= max; y++) ticks.push(Date.UTC(y, 0, 1));
  return ticks.length ? ticks : [min];
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
