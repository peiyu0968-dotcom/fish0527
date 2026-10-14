# 匿名聊天室

不用登入的匿名聊天室。網頁放 GitHub Pages，即時傳訊預計用 Supabase。

- 需求：`docs/requirements.md`
- 架構：`docs/architecture.md`（動工前先讀）
- 畫面設計：`docs/design.md`

## 目前進度：階段二（已接上 Supabase）

資料層有兩個可替換的版本，由 `src/config.ts` 依環境設定選擇：

- **Supabase 版**（`src/backend/supabaseBackend/`）：有設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY` 時使用，真人即時聊天。
- **模擬版**（`src/backend/mockBackend/`）：沒有設定時使用，在瀏覽器裡模擬其他人，不需要任何服務。

Supabase 端的設定與資料庫規則在 `supabase/`（不使用 Supabase CLI，見 `supabase/README.md`）。

## 指令

```bash
npm install      # 安裝套件
npm run dev      # 本機預覽 http://127.0.0.1:5173/
npm test         # 自動化測試（不連網路）
npm run test:live  # 連到真的 Supabase 的完整測試，會在資料庫留下測試訊息
npm run build    # 型別檢查 + 打包到 dist/
npm run preview  # 預覽打包結果（網址有 /fish0527/ 前綴，和 GitHub Pages 一樣）
```

網址後面加 `?debug=1` 會出現測試面板（模擬斷線、限速、檢舉等）。

## 部署

推上 `main` 就會由 `.github/workflows/deploy.yml` 自動測試、打包、上架到 GitHub Pages。
第一次使用需要到倉庫 Settings → Pages，把 Source 設為 **GitHub Actions**。

## 金鑰

只會用到 Project URL 與 Publishable key（兩者都可公開），放在 `.env.local`（本機）與 GitHub 的 Variables（上線）。
Secret key（service_role）與資料庫密碼這個專案完全不用。`.env`、`.env.*` 已被 `.gitignore` 忽略，只有 `.env.example` 會進版控。
