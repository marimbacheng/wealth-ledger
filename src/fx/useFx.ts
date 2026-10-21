import { useCallback, useEffect, useRef, useState } from 'react';
import { txnCurrency } from '../domain/currency';
import type { Store } from '../domain/types';
import { fetchUsdTwd } from './fetchFx';

const STALE_MS = 12 * 3600 * 1000;

// 開啟網站時自動更新匯率：目前匯率超過 12 小時才重抓；台幣交易缺當天匯率時補抓那一天（結果存在 store.fx.history，會跟著同步）
export function useFx(store: Store, update: (fn: (s: Store) => Store) => void) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const tried = useRef(new Set<string>());

  const refresh = useCallback(
    async (force = false) => {
      const cur = store.fx?.current;
      const fresh = cur?.fetchedAt && Date.now() - Date.parse(cur.fetchedAt) < STALE_MS && cur.source !== '手動';
      const needed = [
        ...new Set(
          store.txns
            .filter((t) => txnCurrency(t, store.securities) === 'TWD' && !t.fx && !store.fx?.history?.[t.date] && !tried.current.has(t.date))
            .map((t) => t.date),
        ),
      ].slice(0, 10);
      if (!force && (fresh || cur?.source === '手動') && needed.length === 0) return;
      setState({ busy: true });
      const latest = force || !fresh ? await fetchUsdTwd('latest') : null;
      const past: [string, number][] = [];
      for (const d of needed) {
        tried.current.add(d);
        const q = await fetchUsdTwd(d);
        if (q) past.push([d, q.rate]);
      }
      if (latest || past.length) {
        update((s) => {
          s.fx ??= { history: {} };
          s.fx.history ??= {};
          if (latest && (force || s.fx.current?.source !== '手動')) {
            s.fx.current = { rate: latest.rate, date: latest.date, source: latest.source, fetchedAt: new Date().toISOString() };
            s.fx.history[latest.date] = latest.rate;
          }
          for (const [d, r] of past) s.fx.history[d] = r;
          return s;
        });
      }
      setState({ busy: false, error: (force || !fresh) && !latest ? '匯率服務暫時連不上，先沿用上次的匯率' : undefined });
    },
    [store, update],
  );

  useEffect(() => {
    void refresh(false);
    // 只在開啟時與資料筆數變動時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.txns.length]);

  const setManual = useCallback(
    (rate: number) =>
      update((s) => {
        s.fx ??= { history: {} };
        const d = new Date().toISOString().slice(0, 10);
        s.fx.current = { rate, date: d, source: '手動', fetchedAt: new Date().toISOString() };
        return s;
      }),
    [update],
  );

  return { ...state, refresh: () => refresh(true), setManual };
}

export type FxApi = ReturnType<typeof useFx>;
