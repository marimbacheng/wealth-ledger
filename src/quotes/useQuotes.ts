import { useCallback, useEffect, useState } from 'react';
import type { Store } from '../domain/types';
import type { HoldingRow } from '../engine/report';
import { marketOpen } from './market';
import { applyQuotes, fetchQuotes, shouldPersist, type Quote } from './quotes';

// 開啟網站時自動更新目前持股的報價（距離上次超過 30 分鐘才抓）；開盤時間、頁面開著時每分鐘更新一次；也可以手動按「更新報價」。
// 自動更新的開關、上次更新時間與盤中報價只記在這台裝置；寫進 store.prices（會同步）的規則見 shouldPersist。
const STALE_MS = 30 * 60 * 1000;
const AUTO_KEY = 'autoQuotes';
const LAST_KEY = 'quotesFetchedAt';
const PERSIST_KEY = 'quotesPersistedAt';
export const LIVE_KEY = 'liveQuotes';

export function readLive(): Record<string, Quote> {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 無痕模式等情況存不了：只影響下次是否自動更新
  }
}

export interface QuotesState {
  busy: boolean;
  at?: string; // 上次成功更新的時間
  updated?: number;
  missing: Record<string, string>; // 沒抓到的代號與原因
  error?: string;
}

export function useQuotes(store: Store, holdings: HoldingRow[], update: (fn: (s: Store) => Store) => void, setLive: (fn: (prev: Record<string, Quote>) => Record<string, Quote>) => void) {
  const [auto, setAutoState] = useState(() => readLocal(AUTO_KEY) !== '0');
  const [state, setState] = useState<QuotesState>(() => ({ busy: false, missing: {}, at: readLocal(LAST_KEY) ? new Date(Number(readLocal(LAST_KEY))).toISOString() : undefined }));
  const held = holdings.filter((h) => h.qty > 1e-6);
  const key = held
    .map((h) => `${h.currency}:${h.symbol}`)
    .sort()
    .join(',');

  const refresh = useCallback(
    async (mode: 'open' | 'tick' | 'manual') => {
      const last = Number(readLocal(LAST_KEY) ?? 0);
      if (mode === 'open' && (!auto || Date.now() - last < STALE_MS)) return;
      const us = held.filter((h) => h.currency === 'USD').map((h) => h.symbol);
      const tw = held.filter((h) => h.currency === 'TWD').map((h) => h.symbol);
      if (!us.length && !tw.length) return;
      setState((s) => ({ ...s, busy: true, error: undefined }));
      const r = await fetchQuotes(us, tw, import.meta.env.BASE_URL);
      if (!r) {
        setState((s) => ({ ...s, busy: false, error: '報價服務暫時連不上，先沿用上次的價格' }));
        return;
      }
      const now = Date.now();
      writeLocal(LAST_KEY, String(now));
      setLive((prev) => {
        const next = { ...prev, ...r.quotes };
        writeLocal(LIVE_KEY, JSON.stringify(next));
        return next;
      });
      const { updated } = applyQuotes(store.prices, r.quotes);
      if (updated.length && shouldPersist(store.prices, r.quotes, Number(readLocal(PERSIST_KEY) ?? 0), now, mode === 'manual')) {
        writeLocal(PERSIST_KEY, String(now));
        update((s) => {
          s.prices = applyQuotes(s.prices, r.quotes).prices;
          return s;
        });
      }
      setState({ busy: false, at: new Date(now).toISOString(), updated: updated.length, missing: r.errors });
    },
    // key 代表持股清單；store.prices 只用來算更新幾檔
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, auto, store.prices, update],
  );

  useEffect(() => {
    void refresh('open');
    // 開啟時、持股清單變動時、開啟自動更新時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  // 盤中每分鐘更新（台股或美股任一開盤、頁面在前景時）
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && marketOpen()) void refresh('tick');
    }, 60_000);
    return () => clearInterval(id);
  }, [auto, refresh]);

  const setAuto = useCallback((on: boolean) => {
    writeLocal(AUTO_KEY, on ? '1' : '0');
    setAutoState(on);
  }, []);

  return { ...state, auto, setAuto, refresh: () => refresh('manual') };
}

export type QuotesApi = ReturnType<typeof useQuotes>;
