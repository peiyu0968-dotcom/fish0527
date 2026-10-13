# 匿名聊天室

不用登入的匿名聊天室。網頁放 GitHub Pages，即時傳訊預計用 Supabase。

- 需求：`docs/requirements.md`
- 架構：`docs/architecture.md`（動工前先讀）
- 畫面設計：`docs/design.md`

## 目前進度：階段一（前端 + 模擬資料）

還沒接 Supabase。資料層是 `src/backend/mockBackend/`，在瀏覽器裡模擬其他人、歷史訊息與各種狀況。

## 指令

```bash
npm install      # 安裝套件
npm run dev      # 本機預覽 http://127.0.0.1:5173/
npm test         # 自動化測試
npm run build    # 型別檢查 + 打包到 dist/
npm run preview  # 預覽打包結果（網址有 /fish0527/ 前綴，和 GitHub Pages 一樣）
```

網址後面加 `?debug=1` 會出現測試面板（模擬斷線、限速、檢舉等）。

## 部署

推上 `main` 就會由 `.github/workflows/deploy.yml` 自動測試、打包、上架到 GitHub Pages。
第一次使用需要到倉庫 Settings → Pages，把 Source 設為 **GitHub Actions**。

## 金鑰

階段一沒有任何金鑰。`.env`、`.env.*` 已被 `.gitignore` 忽略，只有 `.env.example` 會進版控。
