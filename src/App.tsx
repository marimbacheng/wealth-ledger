import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Store } from './domain/types';
import { buildReport } from './engine/report';
import { decodeBytes, importText, KIND_LABEL, type ImportKind } from './import';
import { mergeBatch } from './store/merge';
import { loadStore, saveStore } from './store/persist';
import { today } from './ui/format';
import { Dividends } from './ui/pages/Dividends';
import { Holdings } from './ui/pages/Holdings';
import { Ledger } from './ui/pages/Ledger';
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

type Tab = 'overview' | 'holdings' | 'dividends' | 'ledger' | 'setup';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '總覽' },
  { id: 'holdings', label: '持股' },
  { id: 'dividends', label: '股利' },
  { id: 'ledger', label: '交易帳' },
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
  const [updown, setUpdown] = useState(() => readPref('updown', 'tw'));
  const asOf = today();

  useEffect(() => {
    setSaveFailed(!saveStore(store));
  }, [store]);
  useEffect(() => writePref('tab', tab), [tab]);
  useEffect(() => {
    document.documentElement.dataset.updown = updown;
    writePref('updown', updown);
  }, [updown]);

  const report = useMemo(() => buildReport(store, asOf), [store, asOf]);
  const sync = useSync(store, setStore);
  const update = useCallback((fn: (s: Store) => Store) => setStore((s) => fn(structuredClone(s))), []);

  // 匯入要同步回傳結果，所以從 ref 取目前資料、算完再一次 setStore（不能放在 updater 裡，StrictMode 會跑兩次）
  const storeRef = useRef(store);
  storeRef.current = store;
  const importTexts = useCallback((files: { name: string; text: string }[]): ImportResult[] => {
    const results: ImportResult[] = [];
    let s = storeRef.current;
    for (const f of files) {
      const batch = importText(f.text, f.name);
      if (batch.kind === 'unknown') {
        results.push({ file: f.name, kind: batch.kind, label: KIND_LABEL.unknown, added: 0, skipped: 0, warnings: batch.warnings });
        continue;
      }
      const r = mergeBatch(s, batch);
      s = r.store;
      results.push({ file: f.name, kind: batch.kind, label: KIND_LABEL[batch.kind], added: r.added, skipped: r.skipped, warnings: batch.warnings });
    }
    storeRef.current = s;
    setStore(s);
    return results;
  }, []);

  const importFiles = useCallback(
    async (files: File[]) => {
      const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: decodeBytes(await f.arrayBuffer()) })));
      return importTexts(texts);
    },
    [importTexts],
  );

  // 開發模式下讓瀏覽器自動化測試可以直接餵檔案
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ledger = { importTexts, getStore: () => storeRef.current };
  }, [importTexts]);

  const props: PageProps = { store, report, update };
  const empty = store.snapshots.length === 0 && store.txns.length === 0;

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <div className="eyebrow">Private ledger · Schwab → 複委託</div>
          <h1>跨券商總報酬帳</h1>
          <div className="meta">
            資料日 {asOf}
            {report.anchorDate && `　延續帳起算 ${report.anchorDate}`}　單位 USD
          </div>
        </div>
        <div className="controls">
          <SyncBadge sync={sync} onClick={() => setTab('setup')} />
          <label className="controls">
            漲跌色
            <select value={updown} onChange={(e) => setUpdown(e.target.value)}>
              <option value="tw">紅漲綠跌</option>
              <option value="us">綠漲紅跌</option>
            </select>
          </label>
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
          {tab === 'overview' && <Overview {...props} />}
          {tab === 'holdings' && <Holdings {...props} />}
          {tab === 'dividends' && <Dividends {...props} />}
          {tab === 'ledger' && <Ledger {...props} />}
          {tab === 'setup' && <Setup {...props} importFiles={importFiles} sync={sync} />}
        </>
      )}
      <div className="footer">資料只儲存在這台裝置的瀏覽器（localStorage），不會上傳。換裝置或清除瀏覽資料前請下載備份。</div>
    </div>
  );
}
