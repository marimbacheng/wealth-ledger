import { handleHistory } from './history';
import { handleQuotes } from './quotes';

// Cloudflare Worker：/api/quotes 轉送報價、/api/history 轉送歷史價格，其他路徑交給靜態檔（dist/）。
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

// 上游回應在 Cloudflare 邊緣快取：即時行情 30 秒、報價 10 分鐘、歷史價格 12 小時
const cached = (ttl: number) => (url: string, init?: RequestInit) => fetch(url, { ...init, cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
const quoteFetch = (url: string, init?: RequestInit) => cached(url.includes('mis.twse.com.tw') ? 30 : 600)(url, init);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/quotes') return handleQuotes(request, quoteFetch);
    if (pathname === '/api/history') return handleHistory(request, cached(43200));
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
