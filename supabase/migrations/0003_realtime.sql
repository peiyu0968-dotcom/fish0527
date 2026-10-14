-- 0003：開啟即時推送。
-- 訊息表、線上名單表一有變動（新增、修改、刪除），就會經由 WebSocket 推給所有已連線的人。
-- 可以重複執行。

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'online_users'
  ) then
    alter publication supabase_realtime add table public.online_users;
  end if;
end
$$;
