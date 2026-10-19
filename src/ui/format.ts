const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function money(n: number | undefined, opts: { sign?: boolean; whole?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const s = (opts.whole ? usd0 : usd).format(v);
  return opts.sign && v > 0 ? `+${s}` : s;
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
