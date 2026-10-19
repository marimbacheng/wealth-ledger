export interface Flow {
  date: string;
  amount: number; // 投入為負、取回（含期末現值）為正
}

// 年化內部報酬率（XIRR）。先用牛頓法，失敗時退回二分法；算不出來回傳 undefined，不丟例外。
export function xirr(flows: Flow[]): number | undefined {
  if (flows.length < 2) return undefined;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return undefined;
  const t0 = Date.parse(flows[0].date);
  const ts = flows.map((f) => (Date.parse(f.date) - t0) / (365 * 86_400_000));
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, ts[i]), 0);
  const dnpv = (r: number) => flows.reduce((s, f, i) => s - (ts[i] * f.amount) / Math.pow(1 + r, ts[i] + 1), 0);

  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
    if (r <= -0.9999) break;
  }

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  if (Math.sign(flo) === Math.sign(npv(hi))) return undefined;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
