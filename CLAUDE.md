# CLAUDE.md

匿名聊天室：不用登入、所有人在同一個房間，網頁放 GitHub Pages，即時傳訊用 Supabase。

## 規則

- 開始任何工作前，先讀 `docs/architecture.md`（需求在 `docs/requirements.md`，畫面設計在 `docs/design.md`）。
- 目前在「階段二」：資料層已有 Supabase 版（`src/backend/supabaseBackend/`）。`src/config.ts` 依有沒有設定 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 決定用 Supabase 版或階段一的模擬版（`mockBackend`）。
- 畫面層只能透過 `src/backend/types.ts` 的 `ChatBackend` 介面取得資料，不可直接 import supabase。
- 資料庫的規則在 `supabase/migrations/`，不使用 Supabase CLI，改完 SQL 要請使用者到 SQL Editor 重新貼上執行。
- 不可以把金鑰檔案 commit 進 git（`.env`、`.env.*`，只有 `.env.example` 可以進版控）。程式碼裡也不要寫死任何金鑰。
- 這個專案只會用到 Project URL 與 Publishable key（可公開）。**Secret key（service_role）與資料庫密碼絕對不要使用、不要要求使用者貼出來。**
