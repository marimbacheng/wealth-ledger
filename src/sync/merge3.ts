import { emptyStore, type Store } from '../domain/types';

// 三方合併：base = 上次同步成功時的版本，local = 這台裝置現在的資料，remote = 雲端最新版。
// 每筆資料各自比對：只有一邊改（新增、修改、刪除）就採用那一邊；兩邊都改了同一筆，採用這台裝置的版本。
// 這樣兩台裝置各自新增交易不會互相覆蓋，在一台刪掉的紀錄也不會被另一台「救回來」。

// 鍵排序後的 JSON：比對內容時不受欄位順序影響
export function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x,
  );
}
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function mergeKeyed<T>(base: T[], local: T[], remote: T[], key: (x: T) => string): T[] {
  const b = new Map(base.map((x) => [key(x), x]));
  const l = new Map(local.map((x) => [key(x), x]));
  const r = new Map(remote.map((x) => [key(x), x]));
  const out: T[] = [];
  // 保留 remote 的順序，再接上 local 才有的
  const keys = [...r.keys(), ...[...l.keys()].filter((k) => !r.has(k)), ...[...b.keys()].filter((k) => !r.has(k) && !l.has(k))];
  for (const k of keys) {
    const v = pick(b.get(k), l.get(k), r.get(k));
    if (v !== undefined) out.push(v);
  }
  return out;
}

// undefined 代表「不存在」
function pick<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  const localChanged = !same(base, local);
  const remoteChanged = !same(base, remote);
  if (localChanged) return local;
  if (remoteChanged) return remote;
  return base;
}

function mergeRecord<T>(base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const v = pick(base[k], local[k], remote[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function merge3(base: Store | null, local: Store, remote: Store): Store {
  const b = base ?? emptyStore();
  const byDate = <T extends { date: string }>(xs: T[]) => xs.sort((x, y) => x.date.localeCompare(y.date));
  return {
    version: 1,
    txns: mergeKeyed(b.txns, local.txns, remote.txns, (t) => t.id),
    snapshots: byDate(mergeKeyed(b.snapshots, local.snapshots, remote.snapshots, (s) => s.id)),
    realized: mergeKeyed(b.realized, local.realized, remote.realized, (x) => x.id),
    estimates: mergeKeyed(b.estimates, local.estimates, remote.estimates, (e) => e.broker),
    valuePoints: byDate(mergeKeyed(b.valuePoints, local.valuePoints, remote.valuePoints, (v) => v.id)),
    coverage: mergeKeyed(b.coverage, local.coverage, remote.coverage, (c) => `${c.broker}|${c.kind}|${c.from}|${c.to}`),
    imports: mergeKeyed(b.imports, local.imports, remote.imports, (x) => `${x.at}|${x.file}`).sort((x, y) => x.at.localeCompare(y.at)),
    securities: mergeRecord(b.securities, local.securities, remote.securities),
    prices: mergeRecord(b.prices, local.prices, remote.prices),
    settings: mergeSettings(b.settings, local.settings, remote.settings),
    fx: mergeFx(b.fx, local.fx, remote.fx),
  };
}

// 匯率：歷史依日期合併；目前匯率取日期較新的那一份（兩台裝置各自抓到時不分本機優先）
function mergeFx(b?: Store['fx'], l?: Store['fx'], r?: Store['fx']): Store['fx'] {
  const newer = (x?: Store['fx']['current'], y?: Store['fx']['current']) => {
    if (!x) return y;
    if (!y) return x;
    const kx = `${x.date}|${x.fetchedAt ?? ''}`;
    const ky = `${y.date}|${y.fetchedAt ?? ''}`;
    return kx >= ky ? x : y;
  };
  const current = newer(l?.current, r?.current) ?? pick(b?.current, l?.current, r?.current);
  return { ...(current ? { current } : {}), history: mergeRecord(b?.history ?? {}, l?.history ?? {}, r?.history ?? {}) };
}

type Rec = Record<string, unknown>;
function mergeSettings(b: Store['settings'], l: Store['settings'], r: Store['settings']): Store['settings'] {
  const top = mergeRecord(b as unknown as Rec, l as unknown as Rec, r as unknown as Rec) as unknown as Store['settings'];
  // 遷移區間逐欄合併：兩台各改一個日期時都保留
  top.migration = mergeRecord(b.migration as unknown as Rec, l.migration as unknown as Rec, r.migration as unknown as Rec) as unknown as Store['settings']['migration'];
  return top;
}
