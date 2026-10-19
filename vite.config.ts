import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages 專案頁面會掛在 /<repo>/ 底下；部署時由 workflow 設定 BASE_PATH。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
  },
});
