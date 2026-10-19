import { useCallback, useEffect, useRef, useState } from 'react';
import type { Store } from '../domain/types';
import { WrongPassphraseError } from './crypto';
import { syncOnce, type SyncBase, type SyncConfig } from './engine';
import { checkRepo } from './github';
import { merge3, stableStringify } from './merge3';

const CFG_KEY = 'wealth-ledger:sync-config';
const BASE_KEY = 'wealth-ledger:sync-base';

export type SyncState = 'off' | 'blocked' | 'locked' | 'syncing' | 'ok' | 'error';
export interface SyncStatus {
  state: SyncState;
  at?: string;
  message?: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown | null) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 存不了就只在這次開啟期間有效 */
  }
}

// github.io 底下所有專案網站共用同一個網域與 localStorage，不在那裡存 token
export const syncBlocked = () => typeof location !== 'undefined' && location.hostname.endsWith('.github.io');

export function defaultDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return '裝置';
}

const timeNow = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

export function useSync(store: Store, replaceStore: (s: Store) => void) {
  const [config, setConfig] = useState<SyncConfig | null>(() => read<SyncConfig>(CFG_KEY));
  const passRef = useRef<string | undefined>(config?.passphrase);
  const [status, setStatus] = useState<SyncStatus>(() =>
    syncBlocked() ? { state: 'blocked' } : !config ? { state: 'off' } : config.passphrase ? { state: 'syncing' } : { state: 'locked' },
  );
  const storeRef = useRef(store);
  storeRef.current = store;
  const lastCanon = useRef<string | null>(null);
  const running = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const run = useCallback(async (): Promise<boolean> => {
    const cfg = read<SyncConfig>(CFG_KEY);
    const pass = passRef.current;
    if (!cfg || !pass || syncBlocked()) return false;
    if (running.current) {
      pending.current = true;
      return false;
    }
    running.current = true;
    setStatus((s) => ({ ...s, state: 'syncing' }));
    const snapshot = storeRef.current;
    try {
      const res = await syncOnce(snapshot, read<SyncBase>(BASE_KEY), { ...cfg, passphrase: pass });
      write(BASE_KEY, res.base);
      lastCanon.current = stableStringify(res.store);
      if (storeRef.current === snapshot) {
        if (stableStringify(snapshot) !== lastCanon.current) replaceStore(res.store);
      } else {
        // 同步途中又有修改：把這段期間的修改合併進來，下一輪再推上去
        replaceStore(merge3(snapshot, storeRef.current, res.store));
        pending.current = true;
      }
      setStatus({ state: 'ok', at: timeNow(), message: res.pulled ? '已載入其他裝置的更新' : undefined });
      return true;
    } catch (e) {
      const wrong = e instanceof WrongPassphraseError;
      if (wrong && !cfg.passphrase) passRef.current = undefined;
      const offline = e instanceof TypeError; // fetch 失敗（離線）
      setStatus({ state: wrong ? 'locked' : 'error', at: timeNow(), message: offline ? '無法連線，恢復網路後會再試' : (e as Error).message });
      return false;
    } finally {
      running.current = false;
      if (pending.current) {
        pending.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void run(), 300);
      }
    }
  }, [replaceStore]);

  // 開啟時、回到這個分頁時、恢復網路時：拉一次
  useEffect(() => {
    if (!config || syncBlocked()) return;
    void run();
    const onVisible = () => document.visibilityState === 'visible' && void run();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [config, run]);

  // 本機資料有變更：1.5 秒後推上去（連續修改只推一次）
  useEffect(() => {
    // 第一次同步完成前不排程（開啟時那次同步會處理期間的修改）
    if (!config || !passRef.current || syncBlocked() || lastCanon.current === null) return;
    if (stableStringify(store) === lastCanon.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), 1500);
    return () => clearTimeout(timer.current);
  }, [store, config, run]);

  const enable = useCallback(
    async (cfg: SyncConfig, remember: boolean): Promise<string | null> => {
      if (syncBlocked()) return '這個網址（github.io）不支援同步，請改用獨立網域的網址。';
      try {
        const info = await checkRepo({ owner: cfg.owner, repo: cfg.repo, path: cfg.path, token: cfg.token, apiBase: cfg.apiBase });
        if (!info.private) return `${info.fullName} 是公開 repo。為了安全，只允許同步到私人 repo。`;
      } catch (e) {
        return (e as Error).message;
      }
      passRef.current = cfg.passphrase;
      const saved: SyncConfig = { ...cfg, passphrase: remember ? cfg.passphrase : undefined };
      write(CFG_KEY, saved);
      write(BASE_KEY, null);
      lastCanon.current = null;
      setConfig(saved);
      const ok = await run();
      return ok ? null : '同步失敗，詳見狀態訊息';
    },
    [run],
  );

  const unlock = useCallback(
    async (passphrase: string, remember: boolean) => {
      const cfg = read<SyncConfig>(CFG_KEY);
      if (!cfg) return;
      passRef.current = passphrase;
      if (remember) {
        const saved = { ...cfg, passphrase };
        write(CFG_KEY, saved);
        setConfig(saved);
      }
      await run();
    },
    [run],
  );

  const disable = useCallback(() => {
    write(CFG_KEY, null);
    write(BASE_KEY, null);
    passRef.current = undefined;
    lastCanon.current = null;
    setConfig(null);
    setStatus({ state: 'off' });
  }, []);

  return { status, config, enable, unlock, disable, syncNow: run };
}

export type SyncApi = ReturnType<typeof useSync>;
