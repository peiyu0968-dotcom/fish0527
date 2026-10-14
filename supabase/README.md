# Supabase 設定

這個資料夾放「在 Supabase 後台要做的設定」。**不使用 Supabase CLI**，全部在網頁的 SQL Editor 貼上執行。

## 一次性設定（建立專案後）

1. 建立專案，區域選 Tokyo。
2. **Authentication → Sign In / Providers → 打開 Allow anonymous sign-ins**，重新整理確認開關仍是開的。
3. 在 **SQL Editor** 依序執行 `migrations/` 裡的檔案（每個檔案開一個新的 query，貼上，按 Run）：

   | 順序 | 檔案 | 做什麼 |
   |---|---|---|
   | 1 | `0001_tables.sql` | 建立四張資料表，啟用 RLS，收回前端的直接寫入權 |
   | 2 | `0002_functions.sql` | 建立資料庫函式（佔用代號、送訊息、改、刪、檢舉、心跳、離開、管理者工具）|
   | 3 | `0003_realtime.sql` | 讓訊息與線上名單的變動即時推送 |
   | 4 | `0004_storage.sql` | 建立公開的 `chat-files` 儲存桶，單檔上限 10 MB |

   每個檔案都可以重複執行（改過 SQL 後直接再貼一次即可）。

4. 到 **Project Settings → API Keys** 複製 Project URL 與 Publishable key，放進：
   - 本機：專案根目錄的 `.env.local`（參考 `.env.example`，此檔不會被 commit）
   - 上線：GitHub 倉庫 Settings → Secrets and variables → Actions → **Variables**，同名兩個變數

**絕對不要**把 Secret key（service_role）或資料庫密碼放進程式碼、`.env.local` 或 GitHub。這個專案完全用不到它們。

## 管理者日常操作

見 `admin-snippets.sql`。在 SQL Editor 貼上需要的那一段執行即可。

## 已知限制

- 前端能讀到每則訊息的 `author_id`（匿名使用者編號），也就是同一個人的訊息可以被串在一起。這個編號無法對應到真人。
- 使用者刪除訊息時，儲存空間裡已上傳的檔案**不會**自動刪除（只是不再有任何訊息指向它）。定期到 Storage → chat-files 清理。
- 匿名登入預設有每小時每個 IP 的次數上限。很多人在同一個網路下使用時，可能有人暫時進不來，可到 Authentication → Rate Limits 調整。
