import type { Store } from '../domain/types';
import { upgrade } from '../store/persist';
import { seal, unseal, type Envelope } from './crypto';
import { ConflictError, getFile, putFile, type RepoRef } from './github';
import { merge3, stableStringify } from './merge3';

export interface SyncConfig {
  owner: string;
  repo: string;
  path: string;
  token: string;
  passphrase?: string; // 只有勾選「記住」才會存在這台裝置
  device: string;
  apiBase?: string;
}

// 上次同步成功時的雲端版本（三方合併的 base）
export interface SyncBase {
  sha: string;
  json: string;
}

export interface SyncResult {
  store: Store;
  base: SyncBase;
  pulled: boolean; // 雲端有別台裝置的更新
  pushed: boolean;
}

function parseEnvelope(text: string): Envelope {
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    throw new Error('遠端檔案格式不正確');
  }
}

// 一次完整同步：讀雲端 → 解密 → 三方合併 → 有變更才加密寫回。
// 寫回時若被另一台裝置搶先（sha 不符），重新讀取再合併，最多 3 次。解密失敗一律中止，不會覆寫雲端。
export async function syncOnce(local: Store, base: SyncBase | null, cfg: SyncConfig, now = new Date()): Promise<SyncResult> {
  if (!cfg.passphrase) throw new Error('請輸入密語');
  const ref: RepoRef = { owner: cfg.owner, repo: cfg.repo, path: cfg.path, token: cfg.token, apiBase: cfg.apiBase };
  const message = `sync: ${cfg.device || 'device'} ${now.toISOString()}`;
  const localJson = JSON.stringify(local);

  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await getFile(ref);

    if (!remote) {
      const env = await seal(localJson, cfg.passphrase);
      try {
        const { sha } = await putFile(ref, JSON.stringify(env), undefined, message);
        return { store: local, base: { sha, json: localJson }, pulled: false, pushed: true };
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
    }

    const env = parseEnvelope(remote.text);
    let remoteStore: Store;
    let pulled: boolean;
    if (base && base.sha === remote.sha) {
      // 雲端從上次同步後沒變：不用解密，直接以本機為準
      remoteStore = JSON.parse(base.json);
      pulled = false;
    } else {
      remoteStore = upgrade(JSON.parse(await unseal(env, cfg.passphrase)));
      pulled = true;
    }
    const baseStore = base ? (JSON.parse(base.json) as Store) : null;
    const merged = merge3(baseStore, local, remoteStore);
    const mergedJson = JSON.stringify(merged);
    if (stableStringify(merged) === stableStringify(remoteStore)) {
      return { store: merged, base: { sha: remote.sha, json: mergedJson }, pulled, pushed: false };
    }
    // 沿用雲端 salt 寫回前，先確認這台裝置的密語解得開雲端檔案，避免用錯的密語把其他裝置鎖在外面
    if (!pulled) await unseal(env, cfg.passphrase);
    const next = await seal(mergedJson, cfg.passphrase, env.kdf.salt);
    try {
      const { sha } = await putFile(ref, JSON.stringify(next), remote.sha, message);
      return { store: merged, base: { sha, json: mergedJson }, pulled, pushed: true };
    } catch (e) {
      if (e instanceof ConflictError) continue;
      throw e;
    }
  }
  throw new Error('連續 3 次與其他裝置的更新衝突，稍後會再試');
}
