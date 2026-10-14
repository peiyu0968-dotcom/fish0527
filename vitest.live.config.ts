// 「真的連到 Supabase」的測試，會在資料庫裡留下測試訊息，所以不在一般的 npm test 裡跑。
// 用法：npm run test:live（需要 .env.local 裡有 Supabase 的網址與可公開金鑰）
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    env: loadEnv(mode, process.cwd(), 'VITE_'),
  },
}));
