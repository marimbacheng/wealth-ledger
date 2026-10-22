import { useEffect, useMemo, useState } from 'react';
import type { Store } from '../domain/types';
import type { Report } from '../engine/report';
import { betaSource, checks, dailyValues, dataStart, monthlyBeta, NDX, NDX_TR, SPX, SPX_TR, twrIndex, USDTWD, yearlyRows, type History, type PriceSeries } from '../engine/performance';
import { xirr } from '../engine/xirr';
import { pickAnchor } from '../engine/ledger';

// 年度表現與 Beta 需要歷史價格：經本站 /api/history 向 Yahoo 取得，只送代號。
// 結果暫存在這台裝置的瀏覽器 12 小時（約數百 KB），不進同步檔。
const STALE_MS = 12 * 3600 * 1000;
const BATCH = 8;

interface Cached {
  from: string;
  fetchedAt: number;
  series: History;
}

function readCache(key: string): Cached | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && typeof v.from === 'string' && typeof v.fetchedAt === 'number' && v.series ? v : null;
  } catch {
    return null;
  }
}
function writeCache(key: string, v: Cached) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 空間不足或無痕模式：只是下次要重抓
  }
}

const isSeries = (s: unknown): s is PriceSeries => {
  const x = s as PriceSeries;
  return !!x && Array.isArray(x.d) && Array.isArray(x.c) && x.d.length === x.c.length && x.c.every((n) => typeof n === 'number' && n > 0);
};

async function fetchBatch(symbols: string[], interval: '1d' | '1mo', from: string): Promise<History> {
  const qs = new URLSearchParams({ symbols: symbols.join(','), interval, from });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/history?${qs}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const body = (await res.json()) as { series?: Record<string, unknown> };
      const out: History = {};
      for (const [k, s] of Object.entries(body.series ?? {})) if (isSeries(s)) out[k] = s;
      return out;
    } catch {
      // 重試一次
    }
  }
  return {};
}

function useHistory(symbols: string[], interval: '1d' | '1mo', from: string | undefined) {
  const key = `history:${interval}`;
  const want = [...new Set(symbols)].sort().join(',');
  const [state, setState] = useState<{ series?: History; busy: boolean; missing: string[] }>(() => {
    const c = readCache(key);
    return { series: c?.series, busy: false, missing: [] };
  });

  useEffect(() => {
    if (!from || !want) return;
    const c = readCache(key);
    const fresh = c && c.from <= from && Date.now() - c.fetchedAt < STALE_MS;
    const need = want.split(',').filter((s) => !fresh || !c!.series[s]);
    if (!need.length) {
      setState({ series: c!.series, busy: false, missing: [] });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, busy: true }));
    (async () => {
      const batches: string[][] = [];
      for (let i = 0; i < need.length; i += BATCH) batches.push(need.slice(i, i + BATCH));
      const got = await Promise.all(batches.map((b) => fetchBatch(b, interval, from)));
      const series: History = { ...(fresh ? c!.series : {}), ...Object.assign({}, ...got) };
      if (!alive) return;
      writeCache(key, { from, fetchedAt: fresh ? c!.fetchedAt : Date.now(), series });
      setState({ series, busy: false, missing: need.filter((s) => !series[s]) });
    })();
    return () => {
      alive = false;
    };
  }, [key, want, interval, from]);

  return state;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function useAnalytics(store: Store, report: Report) {
  const to = report.asOf;
  const anchor = pickAnchor(store);
  // 起點：交易紀錄連續涵蓋的最早日期（可以完整重建每日總值）；和年化報酬率的「報酬起算點」設定無關
  const from = dataStart(store) ?? report.totalReturn.since ?? anchor?.date;

  const dailySymbols = useMemo(() => {
    if (!from) return [];
    const s = new Set<string>(anchor?.rows.map((r) => r.symbol) ?? []);
    for (const t of store.txns) if (t.symbol && t.date >= from && (t.type === 'BUY' || t.type === 'SELL' || t.type === 'OPEN')) s.add(t.symbol);
    return [...s, SPX, NDX, SPX_TR, NDX_TR, USDTWD];
  }, [store.txns, anchor, from]);
  const daily = useHistory(dailySymbols, '1d', from ? addDays(from, -10) : undefined);

  const held = report.holdings.filter((h) => h.qty > 1e-6);
  const betaSymbols = useMemo(() => [...new Set(held.map((h) => betaSource(store, h.symbol).symbol)), SPX, USDTWD], [held.map((h) => h.symbol).join(','), store.settings.migration.mappings]);
  const monthly = useHistory(betaSymbols, '1mo', addDays(to.slice(0, 8) + '01', -(5 * 365 + 40)));

  const perf = useMemo(() => {
    const hist = daily.series;
    if (!from || !hist?.[SPX]) return undefined;
    const points = dailyValues(store, hist, from, to);
    // 最後一點用報表的目前總值（含今天的報價）
    if (points.length) points[points.length - 1] = { ...points[points.length - 1], value: report.totals.totalValue };
    const idx = twrIndex(points);
    // 累計投入：起點當天的總值當作已投入，之後加上每筆入金（期初持股以市值計）。
    // 同時帶上當天的含息指數，圖上才能算「同樣的投入改買 S&P 500／NASDAQ」
    const spxTr = hist[SPX_TR] ?? hist[SPX];
    const ndxTr = hist[NDX_TR] ?? hist[NDX];
    const level = (s: PriceSeries | undefined) => {
      let i = 0;
      return (d: string) => {
        if (!s) return undefined;
        while (i + 1 < s.d.length && s.d[i + 1] <= d) i++;
        return s.d[i] <= d ? s.c[i] : undefined;
      };
    };
    const spxAt = level(spxTr);
    const ndxAt = level(ndxTr);
    let contribution = points[0]?.value ?? 0;
    const chart = points.map((p, i) => {
      if (i > 0) contribution += p.flow;
      return { date: p.date, value: p.value, contribution, flow: i > 0 ? p.flow : 0, spx: spxAt(p.date), ndx: ndxAt(p.date) };
    });
    // 建議的報酬起算點：資料起點與當天重建的總值；用它算的年化報酬率供參考
    const start = points[0];
    const flows = points.slice(1).filter((p) => p.flow);
    const suggestXirr = start && points.length > 1 ? xirr([{ date: start.date, amount: -start.value }, ...flows.map((p) => ({ date: p.date, amount: -p.flow })), { date: to, amount: report.totals.totalValue }]) : undefined;
    const series = (sym: string) => (hist[sym] ? hist[sym].d.map((d, i) => ({ date: d, idx: hist[sym].c[i] })) : []);
    return {
      years: yearlyRows(idx, hist, from, to),
      checks: checks(store, points),
      chart,
      index: { portfolio: idx, spx: series(hist[SPX_TR] ? SPX_TR : SPX), ndx: series(hist[NDX_TR] ? NDX_TR : NDX) },
      suggest: start ? { date: start.date, value: start.value, xirr: suggestXirr } : undefined,
    };
  }, [daily.series, store, from, to, report.totals.totalValue]);

  const beta = useMemo(() => {
    const hist = monthly.series;
    if (!hist?.[SPX]) return undefined;
    const bySymbol: Record<string, number> = {};
    for (const h of held) {
      const src = betaSource(store, h.symbol);
      const s = hist[src.symbol];
      const b = s ? monthlyBeta(s, hist[SPX], src.fx ? hist[USDTWD] : undefined) : undefined;
      if (b != null) bySymbol[h.symbol] = b;
    }
    const total = report.totals.totalValue;
    const covered = held.filter((h) => bySymbol[h.symbol] != null);
    const portfolio = total > 0 ? covered.reduce((a, h) => a + (h.marketValue / total) * bySymbol[h.symbol], 0) : undefined;
    const missing = held.filter((h) => bySymbol[h.symbol] == null).map((h) => h.symbol);
    return { bySymbol, portfolio, missing };
    // held 由 report 決定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly.series, report, store.settings.migration.mappings]);

  return {
    from,
    busy: daily.busy || monthly.busy,
    missing: [...new Set([...daily.missing, ...monthly.missing])],
    perf,
    beta,
  };
}

export type Analytics = ReturnType<typeof useAnalytics>;
