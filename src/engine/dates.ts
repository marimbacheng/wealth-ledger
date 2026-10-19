export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function addDays(d: string, n: number): string {
  const t = new Date(Date.parse(d) + n * 86_400_000);
  return t.toISOString().slice(0, 10);
}

export function inRange(d: string, from: string, to: string): boolean {
  return d >= from && d <= to;
}

export function yearOf(d: string): number {
  return Number(d.slice(0, 4));
}
