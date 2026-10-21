import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { createFakeGithub } from './dev/fakeGithub';

// 只在開發伺服器啟用：/__fake-github 模擬 GitHub Contents API，用來在瀏覽器裡測試兩台裝置同步
function fakeGithub(): Plugin {
  const gh = createFakeGithub();
  return {
    name: 'fake-github',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fake-github', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const r = gh.handle(req.method ?? 'GET', req.url ?? '/', req.headers.authorization, body);
          res.statusCode = r.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(r.body));
        });
      });
    },
  };
}

// 正式建置時在 HTML 加上內容安全政策：只能載入自己的程式、只能連到 GitHub API，
// 就算哪天混進惡意腳本，也拿不走 token 或把資料送到別處。開發模式不加（HMR 需要 inline script）。
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://api.github.com https://cdn.jsdelivr.net https://*.currency-api.pages.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'".replace(/; frame-ancestors 'none'/, '');
function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// 部署在網域根目錄（Cloudflare Workers）；BASE_PATH 只在需要掛在子路徑時才設定。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), fakeGithub(), cspMeta()],
  test: {
    globals: true,
    environment: 'node',
  },
});
