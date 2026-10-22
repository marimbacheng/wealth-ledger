import { handleQuotes } from './quotes';

// Cloudflare Worker：/api/quotes 轉送報價，其他路徑交給靜態檔（dist/）。
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

// 上游回應在 Cloudflare 邊緣快取 10 分鐘：每日收盤一天只變一次，美股盤中延遲幾分鐘無妨
const UPSTREAM = { cf: { cacheTtl: 600, cacheEverything: true } } as RequestInit;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/quotes') return handleQuotes(request, (url, init) => fetch(url, init), UPSTREAM);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
