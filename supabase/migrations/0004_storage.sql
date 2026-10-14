-- 0004：圖片與檔案的儲存空間。
--  - bucket（儲存桶）名稱 chat-files，公開可讀（網頁要能直接顯示圖片，路徑含隨機碼猜不到）
--  - 單檔上限 10 MB（超過的上傳會被 Supabase 直接拒絕，繞過網頁也一樣）
--  - 已匿名登入的人只能上傳到「自己編號」的資料夾；不能改、不能刪、不能列出別人的檔案
-- 可以重複執行。

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', true, 10485760)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760;

drop policy if exists "chat-files: upload to own folder" on storage.objects;
create policy "chat-files: upload to own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
