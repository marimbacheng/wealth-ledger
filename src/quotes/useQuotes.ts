import { useCallback, useEffect, useState } from 'react';
import type { Store } from '../domain/types';
import type { HoldingRow } from '../engine/report';
import { applyQuotes, fetchQuotes } from './quotes';

// 開啟網站時自動更新目前持股的報價（距離上次超過 30 分鐘才抓）；也可以手動按「更新報價」。
// 自動更新的開關與上次更新時間只記在這台裝置；價格本身存在 store.prices，會跟著同步。
const STALE_MS = 30 * 60 * 1000;
const AUTO_KEY = 'autoQuotes';
const LAST_KEY = 'quotesFetchedAt';

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

export function useQuotes(store: Store, holdings: HoldingRow[], update: (fn: (s: Store) => Store) => void) {
  const [auto, setAutoState] = useState(() => readLocal(AUTO_KEY) !== '0');
  const [state, setState] = useState<QuotesState>(() => ({ busy: false, missing: {}, at: readLocal(LAST_KEY) ? new Date(Number(readLocal(LAST_KEY))).toISOString() : undefined }));
  const held = holdings.filter((h) => h.qty > 1e-6);
  const key = held
    .map((h) => `${h.currency}:${h.symbol}`)
    .sort()
    .join(',');

  const refresh = useCallback(
    async (force: boolean) => {
      const last = Number(readLocal(LAST_KEY) ?? 0);
      if (!force && (!auto || Date.now() - last < STALE_MS)) return;
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
      const { updated } = applyQuotes(store.prices, r.quotes);
      if (updated.length) {
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
    void refresh(false);
    // 開啟時、持股清單變動時、開啟自動更新時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  const setAuto = useCallback((on: boolean) => {
    writeLocal(AUTO_KEY, on ? '1' : '0');
    setAutoState(on);
  }, []);

  return { ...state, auto, setAuto, refresh: () => refresh(true) };
}

export type QuotesApi = ReturnType<typeof useQuotes>;
