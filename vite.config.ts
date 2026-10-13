/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 的網址是 https://<帳號>.github.io/<倉庫名稱>/，
// 所以打包（build）時所有檔案路徑都要加上 /<倉庫名稱>/ 前綴；
// 本機開發（dev）時網址是 http://localhost:5173/，不需要前綴。
const REPO_NAME = 'fish0527';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
}));
