import { emptyStore, type Store } from '../domain/types';

const KEY = 'wealth-ledger:v1';

// 資料只存在這台裝置的瀏覽器；GitHub Pages 上只放程式，不放任何財務資料。
export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    return upgrade(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

export function saveStore(s: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function clearStore(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 無法存取 storage 時沒有東西可清 */
  }
}

// 備份檔匯入：補齊新版欄位，拒絕不認得的格式
export function upgrade(data: unknown): Store {
  if (!data || typeof data !== 'object' || (data as Store).version !== 1) {
    throw new Error('不是這個 App 的備份檔（version 不符）');
  }
  const base = emptyStore();
  const d = data as Partial<Store>;
  return {
    ...base,
    ...d,
    settings: { ...base.settings, ...d.settings, migration: { ...base.settings.migration, ...d.settings?.migration } },
  } as Store;
}
