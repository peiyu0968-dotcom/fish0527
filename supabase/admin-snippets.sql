-- 管理者日常操作。在 Supabase 後台的 SQL Editor 貼上「需要的那一段」執行。
-- 一次只執行一段（貼上前先清掉編輯區原本的內容）。

-- 1. 看被自動隱藏的訊息，以及被檢舉幾次
select m.id, m.nickname, m.created_at,
       h.content as original_content,
       h.attachment as original_attachment,
       (select count(*) from public.reports r where r.message_id = m.id) as reports
from public.messages m
join public.hidden_contents h on h.message_id = m.id
where m.hidden
order by m.id desc;

-- 2. 恢復某一則（把 123 換成訊息編號）。恢復後標記「管理者已確認」，之後不會再被自動隱藏
select public.admin_restore_message(123);

-- 3. 刪除某一則（把 123 換成訊息編號）。畫面上會顯示「此訊息已刪除」
select public.admin_delete_message(123);

-- 4. 看最近 50 則訊息
select id, kind, nickname, left(content, 40) as content, created_at, hidden, deleted_at
from public.messages
order by id desc
limit 50;

-- 5. 看目前在線的人
select nickname, last_seen from public.online_users order by last_seen desc;

-- 6. 看目前用掉多少儲存空間（單位 MB）
select round(sum((metadata->>'size')::bigint) / 1024.0 / 1024.0, 1) as storage_mb,
       count(*) as files
from storage.objects
where bucket_id = 'chat-files';

-- 7. 清掉自動化測試留下的資料（npm run test:live 會用「測試甲／乙／丙／丁」這幾個代號）
--    只刪代號以「測試」開頭的訊息；檢舉紀錄與隱藏內容會一起刪。
--    檔案要另外到 Storage → chat-files 手動刪除（資料庫不能直接刪儲存的檔案）。
delete from public.messages where nickname like '測試%';
delete from public.online_users where nickname like '測試%';
