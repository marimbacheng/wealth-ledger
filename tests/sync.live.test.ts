import { emptyStore, type Txn } from '../src/domain/types';
import { syncOnce, type SyncConfig } from '../src/sync/engine';
import { checkRepo, getFile } from '../src/sync/github';

// 對真正的 GitHub API 跑一次同步流程。只在本機手動執行：
//   LIVE_GITHUB_TOKEN=$(gh auth token) LIVE_GITHUB_REPO=owner/repo npx vitest run tests/sync.live.test.ts
// 寫到 _selftest/ 底下的暫存檔，測完刪掉。
const token = process.env.LIVE_GITHUB_TOKEN;
const [owner, repo] = (process.env.LIVE_GITHUB_REPO ?? '/').split('/');

describe.skipIf(!token || !owner || !repo)('真實 GitHub API', () => {
  const path = `_selftest/${Date.now()}.json`;
  const cfg = (device: string, passphrase = 'live-pass'): SyncConfig => ({ owner, repo, path, token: token!, passphrase, device });
  const txn = (id: string): Txn => ({ id, broker: 'tw', date: '2026-11-01', type: 'DEPOSIT', amount: 1, source: 'manual' });

  afterAll(async () => {
    const cur = await getFile({ owner, repo, path, token: token! });
    if (!cur) return;
    await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ message: 'selftest cleanup', sha: cur.sha }),
    });
  });

  it('repo 是私人的', async () => {
    expect((await checkRepo({ owner, repo, path, token: token! })).private).toBe(true);
  });

  it('上傳、下載、兩邊新增、409 重試都在真實 API 上成立；雲端內容是加密的', async () => {
    const a1 = await syncOnce({ ...emptyStore(), txns: [txn('a')] }, null, cfg('A'));
    expect(a1.pushed).toBe(true);

    const raw = await getFile({ owner, repo, path, token: token! });
    expect(raw!.text).not.toContain('DEPOSIT');
    expect(JSON.parse(raw!.text).cipher).toBe('AES-GCM');

    const b1 = await syncOnce(emptyStore(), null, cfg('B'));
    expect(b1.store.txns.map((t) => t.id)).toEqual(['a']);

    // A 用舊的 base 寫入前，B 先寫 → A 會遇到 409 再重試
    await syncOnce({ ...b1.store, txns: [...b1.store.txns, txn('b')] }, b1.base, cfg('B'));
    const a2 = await syncOnce({ ...a1.store, txns: [...a1.store.txns, txn('a2')] }, a1.base, cfg('A'));
    expect(a2.store.txns.map((t) => t.id).sort()).toEqual(['a', 'a2', 'b']);

    await expect(syncOnce(emptyStore(), null, cfg('C', 'wrong'))).rejects.toThrow('密語不正確');
  }, 60_000);
});
