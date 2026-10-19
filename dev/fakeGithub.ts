// 開發與測試用的假 GitHub Contents API（記憶體內），行為比照真的 API：
// 檔案不存在回 404；更新時 sha 不符回 409；建立已存在的檔案但沒帶 sha 回 422。
// 只接受 token「test-token」，避免任何真實 token 被拿來測試。
import { createHash } from 'node:crypto';

export const FAKE_TOKEN = 'test-token';

interface FileRec {
  content: string; // base64
  sha: string;
}

export function createFakeGithub() {
  const files = new Map<string, FileRec>();
  let commits = 0;

  function handle(method: string, url: string, auth: string | undefined, body: string): { status: number; body: unknown } {
    if (auth !== `Bearer ${FAKE_TOKEN}`) return { status: 401, body: { message: 'Bad credentials' } };
    const u = new URL(url, 'http://fake');
    const m = u.pathname.match(/\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/);
    if (!m) return { status: 404, body: { message: 'Not Found' } };
    const [, owner, repo, path] = m;
    if (!path) return method === 'GET' ? { status: 200, body: { private: true, full_name: `${owner}/${repo}` } } : { status: 405, body: {} };
    const key = `${owner}/${repo}/${decodeURIComponent(path)}`;
    const cur = files.get(key);
    if (method === 'GET') {
      if (!cur) return { status: 404, body: { message: 'Not Found' } };
      return { status: 200, body: { content: cur.content, encoding: 'base64', sha: cur.sha } };
    }
    if (method === 'PUT') {
      const j = JSON.parse(body || '{}');
      if (cur && !j.sha) return { status: 422, body: { message: '"sha" wasn\'t supplied.' } };
      if (cur && j.sha !== cur.sha) return { status: 409, body: { message: 'is at x but expected y' } };
      if (!cur && j.sha) return { status: 409, body: { message: 'file does not exist' } };
      const sha = createHash('sha1').update(`${++commits}|${j.content}`).digest('hex');
      files.set(key, { content: j.content, sha });
      return { status: cur ? 200 : 201, body: { content: { sha } } };
    }
    return { status: 405, body: {} };
  }

  // 給測試用：與 window.fetch 相容
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const h = new Headers(init?.headers);
    const r = handle(init?.method ?? 'GET', url, h.get('Authorization') ?? undefined, (init?.body as string) ?? '');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };

  return { handle, fetch: fetchImpl, files, commitCount: () => commits };
}
