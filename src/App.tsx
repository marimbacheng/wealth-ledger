import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Store } from './domain/types';
import { buildReport } from './engine/report';
import { importBytes, importText, KIND_LABEL, type ImportBatch, type ImportKind } from './import';
import { mergeBatch } from './store/merge';
import { loadStore, saveStore } from './store/persist';
import { setDisplay, today } from './ui/format';
import { useFx } from './fx/useFx';
import { readLive, useQuotes } from './quotes/useQuotes';
import { applyQuotes, type Quote } from './quotes/quotes';
import { useAnalytics } from './perf/useAnalytics';
import { Dividends } from './ui/pages/Dividends';
import { Holdings } from './ui/pages/Holdings';
import { Ledger } from './ui/pages/Ledger';
import { Migration } from './ui/pages/Migration';
import { Overview } from './ui/pages/Overview';
import { Setup } from './ui/pages/Setup';
import { useSync } from './sync/useSync';
import { SyncBadge } from './ui/SyncCard';

export interface ImportResult {
  file: string;
  kind: ImportKind;
  label: string;
  added: number;
  skipped: number;
  warnings: string[];
}

export interface PageProps {
  store: Store;
  report: ReturnType<typeof buildReport>;
  update: (fn: (s: Store) => Store) => void;
}

type Tab = 'overview' | 'holdings' | 'dividends' | 'ledger' | 'migration' | 'setup';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '總覽' },
  { id: 'holdings', label: '持股' },
  { id: 'dividends', label: '股利' },
  { id: 'ledger', label: '交易帳' },
  { id: 'migration', label: '移轉紀錄' },
  { id: 'setup', label: '匯入與設定' },
];

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 偏好設定存不了就算了 */
  }
}

export default function App() {
  const [store, setStore] = useState<Store>(() => loadStore());
  const [saveFailed, setSaveFailed] = useState(false);
  const [tab, setTab] = useState<Tab>(() => (store.snapshots.length || store.txns.length ? (readPref('tab', 'overview') as Tab) : 'setup'));
  // 預設綠漲紅跌；只有使用者自己切換過才記住（換了儲存鍵，舊版自動存下的設定不再沿用）
  const [updown, setUpdown] = useState(() => readPref('updown-v2', 'us'));
  // 外觀：auto 跟隨系統，light／dark 由使用者指定
  const [theme, setTheme] = useState(() => readPref('theme', 'auto'));
  // 顯示幣別：報表一律以美元計算，切到台幣時用目前匯率換算
  const [dispCur, setDispCur] = useState(() => (readPref('displayCurrency', 'USD') === 'TWD' ? 'TWD' : 'USD') as 'USD' | 'TWD');
  const asOf = today();

  useEffect(() => {
    setSaveFailed(!saveStore(store));
  }, [store]);
  useEffect(() => writePref('tab', tab), [tab]);
  // 從總覽小卡跳過去：切換頁面後捲到目標區塊，短暫標示
  const [focus, setFocus] = useState<string>();
  const go = useCallback((t: Tab, target?: string) => {
    setTab(t);
    setFocus(target);
  }, []);
  useEffect(() => {
    if (!focus) return;
    // 等新頁面畫好再捲（用計時器而不是 requestAnimationFrame：分頁在背景時後者會暫停）
    const id = setTimeout(() => {
      const el = document.getElementById(focus);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' });
        // 有些環境（例如背景視窗、省電模式）平滑捲動不會動：0.7 秒後還沒到就直接跳過去
        setTimeout(() => {
          const top = el.getBoundingClientRect().top;
          if (top < -4 || top > 80) el.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'center' });
        }, 700);
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
      setFocus(undefined);
    }, 30);
    return () => clearTimeout(id);
  }, [focus, tab]);
  useEffect(() => {
    document.documentElement.dataset.updown = updown;
  }, [updown]);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'light' || theme === 'dark') el.dataset.theme = theme;
    else delete el.dataset.theme;
  }, [theme]);

  // 盤中報價只放在這台裝置，蓋在帳本的價格上算報表（規則同自動報價：同一天不蓋掉手動價格）
  const [live, setLive] = useState<Record<string, Quote>>(readLive);
  const effective = useMemo(() => (Object.keys(live).length ? { ...store, prices: applyQuotes(store.prices, live).prices } : store), [store, live]);
  const report = useMemo(() => buildReport(effective, asOf), [effective, asOf]);
  const sync = useSync(store, setStore);
  setDisplay(dispCur, report.fx?.rate);
  const update = useCallback((fn: (s: Store) => Store) => setStore((s) => fn(structuredClone(s))), []);
  const fx = useFx(store, update);
  const quotes = useQuotes(store, report.holdings, update, setLive);
  const analytics = useAnalytics(effective, report);

  // 匯入要同步回傳結果，所以從 ref 取目前資料、算完再一次 setStore（不能放在 updater 裡，StrictMode 會跑兩次）
  const storeRef = useRef(store);
  storeRef.current = store;
  const mergeBatches = useCallback((batches: ImportBatch[]): ImportResult[] => {
    const results: ImportResult[] = [];
    let s = storeRef.current;
    for (const batch of batches) {
      if (batch.kind === 'unknown') {
        results.push({ file: batch.file, kind: batch.kind, label: KIND_LABEL.unknown, added: 0, skipped: 0, warnings: batch.warnings });
        continue;
      }
      const r = mergeBatch(s, batch);
      s = r.store;
      results.push({ file: batch.file, kind: batch.kind, label: KIND_LABEL[batch.kind], added: r.added, skipped: r.skipped, warnings: [...batch.warnings, ...r.warnings] });
    }
    storeRef.current = s;
    setStore(s);
    return results;
  }, []);

  const importTexts = useCallback((files: { name: string; text: string }[]) => mergeBatches(files.map((f) => importText(f.text, f.name))), [mergeBatches]);

  const importFiles = useCallback(
    async (files: File[]) => mergeBatches(await Promise.all(files.map(async (f) => importBytes(await f.arrayBuffer(), f.name)))),
    [mergeBatches],
  );

  // 開發模式下讓瀏覽器自動化測試可以直接餵檔案
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ledger = { importTexts, importFiles, getStore: () => storeRef.current };
  }, [importTexts, importFiles]);

  const props: PageProps = { store, report, update };
  const empty = store.snapshots.length === 0 && store.txns.length === 0;

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <div className="eyebrow">PRIVATE LEDGER · Schwab → 永豐</div>
          <h1>跨券商總報酬帳</h1>
          <div className="meta">
            資料日 {asOf}
            {report.anchorDate && `　延續帳起算 ${report.anchorDate}`}
            {dispCur === 'TWD' && report.fx ? `　單位 TWD（1 美元 = ${report.fx.rate} 台幣）` : '　單位 USD'}
          </div>
        </div>
        <div className="controls">
          <SyncBadge sync={sync} onClick={() => setTab('setup')} />
          <div className="prefs">
            <label className="pref" title={report.fx ? `1 美元 = ${report.fx.rate} 台幣（${report.fx.date ?? ''}）` : '尚未取得匯率'}>
              <span>幣別</span>
              <select
                value={dispCur}
                onChange={(e) => {
                  const v = e.target.value === 'TWD' ? 'TWD' : 'USD';
                  setDispCur(v);
                  writePref('displayCurrency', v);
                }}
              >
                <option value="USD">美元</option>
                <option value="TWD" disabled={!report.fx}>
                  台幣
                </option>
              </select>
            </label>
            <label className="pref">
              <span>外觀</span>
              <select
                value={theme}
                onChange={(e) => {
                  setTheme(e.target.value);
                  writePref('theme', e.target.value);
                }}
              >
                <option value="auto">跟隨系統</option>
                <option value="light">淺色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label className="pref">
              <span>漲跌色</span>
              <select
                value={updown}
                onChange={(e) => {
                  setUpdown(e.target.value);
                  writePref('updown-v2', e.target.value);
                }}
              >
                <option value="us">綠漲紅跌</option>
                <option value="tw">紅漲綠跌</option>
              </select>
            </label>
          </div>
        </div>
      </header>
      {saveFailed && <div className="notice">瀏覽器無法儲存資料（可能是私密瀏覽模式）。關閉分頁前請先到「匯入與設定」下載備份。</div>}
      <nav className="tabs" role="tablist">
        {TABS.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="no">{String(i + 1).padStart(2, '0')}</span>
            {t.label}
          </button>
        ))}
      </nav>
      {empty && tab !== 'setup' ? (
        <div className="card" style={{ marginTop: 24 }}>
          還沒有資料。請到 <a href="#" onClick={(e) => (e.preventDefault(), setTab('setup'))}>匯入與設定</a> 匯入 Schwab 的匯出檔。
        </div>
      ) : (
        <>
          {tab === 'overview' && <Overview {...props} analytics={analytics} go={go} />}
          {tab === 'holdings' && <Holdings {...props} quotes={quotes} analytics={analytics} />}
          {tab === 'dividends' && <Dividends {...props} />}
          {tab === 'ledger' && <Ledger {...props} />}
          {tab === 'migration' && <Migration {...props} />}
          {tab === 'setup' && <Setup {...props} importFiles={importFiles} sync={sync} fx={fx} quotes={quotes} analytics={analytics} />}
        </>
      )}
      <div className="footer">資料只儲存在這台裝置的瀏覽器（localStorage），不會上傳。換裝置或清除瀏覽資料前請下載備份。</div>
    </div>
  );
}
