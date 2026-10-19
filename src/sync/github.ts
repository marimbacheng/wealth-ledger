// GitHub Contents API：讀寫私人 repo 裡的一個檔案。寫入時帶上目前的 sha，
// 若另一台裝置先寫了，GitHub 會拒絕（409），由同步流程重新讀取、合併再寫。

export interface RepoRef {
  owner: string;
  repo: string;
  path: string;
  token: string;
  apiBase?: string; // 預設 https://api.github.com；開發測試時指向本機假 API
}

export class SyncHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class ConflictError extends SyncHttpError {}

const api = (r: RepoRef) => (r.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
const contentsUrl = (r: RepoRef) => `${api(r)}/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/contents/${r.path.split('/').map(encodeURIComponent).join('/')}`;

function headers(r: RepoRef, accept = 'application/vnd.github+json'): HeadersInit {
  return { Authorization: `Bearer ${r.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

function explain(status: number, body: string): string {
  if (status === 401) return 'Token 無效或已過期';
  if (status === 403) return /rate limit/i.test(body) ? 'GitHub API 次數超過上限，稍後再試' : 'Token 權限不足（需要這個 repo 的 Contents 讀寫）';
  if (status === 404) return '找不到 repo，或 token 沒有這個 repo 的權限';
  return `GitHub 回應 ${status}`;
}

async function fail(res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  throw new SyncHttpError(res.status, explain(res.status, body));
}

const utf8ToB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64: string) => {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

// 確認 token 看得到這個 repo，且 repo 是私人的
export async function checkRepo(r: RepoRef): Promise<{ private: boolean; fullName: string }> {
  const res = await fetch(`${api(r)}/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`, { headers: headers(r), cache: 'no-store' });
  if (!res.ok) await fail(res);
  const j = await res.json();
  return { private: Boolean(j.private), fullName: j.full_name };
}

export async function getFile(r: RepoRef): Promise<{ text: string; sha: string } | null> {
  const res = await fetch(contentsUrl(r), { headers: headers(r), cache: 'no-store' });
  if (res.status === 404) {
    // 檔案不存在 vs repo 不存在：再確認一次 repo
    await checkRepo(r);
    return null;
  }
  if (!res.ok) await fail(res);
  const j = await res.json();
  if (j.content && j.encoding === 'base64') return { text: b64ToUtf8(j.content), sha: j.sha };
  // 超過 1 MB 的檔案 content 會是空的，改抓原始內容
  const raw = await fetch(contentsUrl(r), { headers: headers(r, 'application/vnd.github.raw+json'), cache: 'no-store' });
  if (!raw.ok) await fail(raw);
  return { text: await raw.text(), sha: j.sha };
}

export async function putFile(r: RepoRef, text: string, sha: string | undefined, message: string): Promise<{ sha: string }> {
  const res = await fetch(contentsUrl(r), {
    method: 'PUT',
    headers: { ...headers(r), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: utf8ToB64(text), ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || (res.status === 422 && !sha)) {
    throw new ConflictError(res.status, '另一台裝置剛更新過，重新同步中');
  }
  if (!res.ok) await fail(res);
  const j = await res.json();
  return { sha: j.content.sha };
}
