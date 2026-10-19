import { afterEach, beforeEach, vi } from 'vitest';
import { createFakeGithub, FAKE_TOKEN } from '../dev/fakeGithub';
import { emptyStore, type Store, type Txn } from '../src/domain/types';
import { seal, unseal, WrongPassphraseError } from '../src/sync/crypto';
import { syncOnce, type SyncBase, type SyncConfig } from '../src/sync/engine';
import { merge3 } from '../src/sync/merge3';
import { hasRealData, loadRealStore } from './realdata';

const txn = (id: string, amount = 1): Txn => ({ id, broker: 'tw', date: '2026-11-01', type: 'DEPOSIT', amount, source: 'manual' });
const storeWith = (...ids: string[]): Store => ({ ...emptyStore(), txns: ids.map((i) => txn(i)) });
const ids = (s: Store) => s.txns.map((t) => t.id).sort();

describe('加密', () => {
  it('來回加解密；信封裡看不到明文', async () => {
    const plain = JSON.stringify({ secret: 'AAPL 6 shares cost 1234.56' });
    const env = await seal(plain, 'correct horse');
    expect(JSON.stringify(env)).not.toContain('AAPL');
    expect(await unseal(env, 'correct horse')).toBe(plain);
  });

  it('密語錯誤或內容被竄改都會失敗', async () => {
    const env = await seal('hello', 'pw-1');
    await expect(unseal(env, 'pw-2')).rejects.toBeInstanceOf(WrongPassphraseError);
    const bytes = atob(env.data);
    const tampered = { ...env, data: btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1)) };
    await expect(unseal(tampered, 'pw-1')).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe('三方合併', () => {
  it('兩邊各自新增都保留', () => {
    expect(ids(merge3(storeWith('a'), storeWith('a', 'b'), storeWith('a', 'c')))).toEqual(['a', 'b', 'c']);
  });
  it('一邊刪除、另一邊沒動 → 刪除生效（不會被救回來）', () => {
    expect(ids(merge3(storeWith('a', 'b'), storeWith('a'), storeWith('a', 'b')))).toEqual(['a']);
    expect(ids(merge3(storeWith('a', 'b'), storeWith('a', 'b'), storeWith('b')))).toEqual(['b']);
  });
  it('兩邊改同一筆 → 採用這台裝置的版本', () => {
    const base = storeWith('a');
    const local = { ...base, txns: [txn('a', 10)] };
    const remote = { ...base, txns: [txn('a', 20)] };
    expect(merge3(base, local, remote).txns[0].amount).toBe(10);
  });
  it('沒有 base（第二台裝置第一次同步）→ 聯集', () => {
    expect(ids(merge3(null, storeWith('a', 'x'), storeWith('a', 'y')))).toEqual(['a', 'x', 'y']);
  });
  it('遷移區間逐欄合併', () => {
    const base = emptyStore();
    const local = structuredClone(base);
    local.settings.migration.schwabSellTo = '2026-11-30';
    const remote = structuredClone(base);
    remote.settings.migration.twBuyTo = '2027-02-28';
    const m = merge3(base, local, remote).settings.migration;
    expect([m.schwabSellTo, m.twBuyTo]).toEqual(['2026-11-30', '2027-02-28']);
  });
});

describe('兩台裝置同步（假 GitHub API）', () => {
  let gh: ReturnType<typeof createFakeGithub>;
  beforeEach(() => {
    gh = createFakeGithub();
    vi.stubGlobal('fetch', gh.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const cfg = (device: string, passphrase = 'same-pass'): SyncConfig => ({
    owner: 'me',
    repo: 'data',
    path: 'ledger.enc.json',
    token: FAKE_TOKEN,
    passphrase,
    device,
    apiBase: 'http://fake',
  });

  it('A 上傳、B 下載；兩邊同時新增後都拿到對方的；刪除也會同步', async () => {
    let a = storeWith('a1');
    let aBase: SyncBase | null = null;
    let b = emptyStore();
    let bBase: SyncBase | null = null;

    let r = await syncOnce(a, aBase, cfg('A'));
    expect(r.pushed).toBe(true);
    [a, aBase] = [r.store, r.base];

    r = await syncOnce(b, bBase, cfg('B'));
    expect(r.pulled).toBe(true);
    [b, bBase] = [r.store, r.base];
    expect(ids(b)).toEqual(['a1']);

    a = { ...a, txns: [...a.txns, txn('a2')] };
    b = { ...b, txns: [...b.txns, txn('b1')] };
    r = await syncOnce(a, aBase, cfg('A'));
    [a, aBase] = [r.store, r.base];
    r = await syncOnce(b, bBase, cfg('B'));
    [b, bBase] = [r.store, r.base];
    expect(ids(b)).toEqual(['a1', 'a2', 'b1']);
    r = await syncOnce(a, aBase, cfg('A'));
    [a, aBase] = [r.store, r.base];
    expect(ids(a)).toEqual(['a1', 'a2', 'b1']);

    b = { ...b, txns: b.txns.filter((t) => t.id !== 'a1') };
    r = await syncOnce(b, bBase, cfg('B'));
    [b, bBase] = [r.store, r.base];
    r = await syncOnce(a, aBase, cfg('A'));
    expect(ids(r.store)).toEqual(['a2', 'b1']);
  });

  it('沒有變更時不會產生新的 commit', async () => {
    const r1 = await syncOnce(storeWith('x'), null, cfg('A'));
    const n = gh.commitCount();
    const r2 = await syncOnce(r1.store, r1.base, cfg('A'));
    expect(r2.pushed).toBe(false);
    expect(gh.commitCount()).toBe(n);
  });

  it('密語錯誤：拋錯而且不會覆寫雲端', async () => {
    await syncOnce(storeWith('x'), null, cfg('A'));
    const n = gh.commitCount();
    await expect(syncOnce(storeWith('y'), null, cfg('C', 'wrong'))).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(gh.commitCount()).toBe(n);
  });

  it('寫回前被另一台搶先（409）→ 重新讀取合併再寫，兩邊資料都在', async () => {
    const first = await syncOnce(storeWith('base'), null, cfg('A'));
    const realFetch = gh.fetch;
    const statuses: number[] = [];
    let interfered = false;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && !interfered) {
        interfered = true;
        // A 已經讀完、準備寫回的瞬間，B 搶先寫入
        vi.stubGlobal('fetch', realFetch);
        await syncOnce({ ...first.store, txns: [...first.store.txns, txn('other')] }, first.base, cfg('B'));
      }
      const res = await realFetch(input, init);
      if (init?.method === 'PUT') statuses.push(res.status);
      return res;
    });
    const r = await syncOnce({ ...first.store, txns: [...first.store.txns, txn('mine')] }, first.base, cfg('A'));
    expect(statuses[0]).toBe(409);
    expect(ids(r.store)).toEqual(['base', 'mine', 'other']);
    const check = await syncOnce(emptyStore(), null, cfg('C'));
    expect(ids(check.store)).toEqual(['base', 'mine', 'other']);
  });

  it('錯的 token 會得到清楚的錯誤訊息', async () => {
    await expect(syncOnce(storeWith('x'), null, { ...cfg('A'), token: 'nope' })).rejects.toThrow('Token 無效或已過期');
  });
});

describe.skipIf(!hasRealData)('真實資料加密後的大小', () => {
  it('壓縮加密後遠小於 GitHub 1 MB 的一般讀取上限', async () => {
    const s = loadRealStore();
    const plain = JSON.stringify(s);
    const env = JSON.stringify(await seal(plain, 'x'));
    expect(env.length).toBeLessThan(plain.length);
    expect(env.length).toBeLessThan(1_000_000);
  });
});
