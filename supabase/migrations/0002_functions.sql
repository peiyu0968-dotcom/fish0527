-- 0002：資料庫函式。前端所有「寫入」都只能呼叫這些函式，規則在這裡檢查，使用者繞不過。
-- 失敗時用 raise exception '錯誤代碼'，前端依代碼決定顯示什麼（對應 src/backend/types.ts 的 ErrorCode）。
-- 可以重複執行。

-- ---------------------------------------------------------------
-- 內部：清掉逾時 45 秒沒心跳的人，並替他們補上「離開」訊息
-- ---------------------------------------------------------------
create or replace function public.sweep_stale_users()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    delete from public.online_users
    where last_seen < now() - interval '45 seconds'
    returning nickname, user_id
  loop
    insert into public.messages (kind, author_id, nickname)
    values ('leave', r.user_id, r.nickname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------
-- 佔用代號（進入聊天室）
-- ---------------------------------------------------------------
create or replace function public.claim_nickname(p_nickname text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  holder   uuid;
  old_nick text;
begin
  if uid is null then
    raise exception 'NOT_JOINED';
  end if;
  if p_nickname is null or p_nickname !~ '^[A-Za-z0-9一-鿿]{1,12}$' then
    raise exception 'NICKNAME_INVALID';
  end if;

  -- 同一時間只讓一個人在搶代號，避免兩人同時搶到
  perform pg_advisory_xact_lock(7001);
  perform public.sweep_stale_users();

  select user_id into holder
  from public.online_users
  where lower(nickname) = lower(p_nickname);

  if holder is not null and holder <> uid then
    raise exception 'NICKNAME_TAKEN';
  end if;

  select nickname into old_nick from public.online_users where user_id = uid;

  -- 同一個人重新連線、用同一個代號：直接接手，不再多一則「進入」
  if old_nick is not null and old_nick = p_nickname then
    update public.online_users set last_seen = now() where user_id = uid;
    return;
  end if;

  -- 同一個人換了代號：舊的先離開
  if old_nick is not null then
    delete from public.online_users where user_id = uid;
    insert into public.messages (kind, author_id, nickname)
    values ('leave', uid, old_nick);
  end if;

  insert into public.online_users (nickname, user_id) values (p_nickname, uid);
  insert into public.messages (kind, author_id, nickname)
  values ('join', uid, p_nickname);
end;
$$;

-- ---------------------------------------------------------------
-- 心跳：每 15 秒呼叫一次，告訴系統「我還在」
-- 如果已經被判定離線（找不到自己），回報 NOT_JOINED，前端會重新佔用代號
-- ---------------------------------------------------------------
create or replace function public.heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n   int;
begin
  if uid is null then
    raise exception 'NOT_JOINED';
  end if;

  update public.online_users set last_seen = now() where user_id = uid;
  get diagnostics n = row_count;

  perform public.sweep_stale_users();

  if n = 0 then
    raise exception 'NOT_JOINED';
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 離開
-- ---------------------------------------------------------------
create or replace function public.leave_room()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  nick text;
begin
  if uid is null then
    return;
  end if;

  delete from public.online_users where user_id = uid returning nickname into nick;
  if nick is not null then
    insert into public.messages (kind, author_id, nickname)
    values ('leave', uid, nick);
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 送出訊息：檢查已進入、不是空訊息、附件合法、10 秒內不超過 5 則
-- ---------------------------------------------------------------
create or replace function public.send_message(p_content text, p_attachment jsonb default null)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  nick    text;
  body    text := coalesce(p_content, '');
  att     jsonb := null;
  recent  int;
  msg     public.messages;
begin
  if uid is null then
    raise exception 'NOT_JOINED';
  end if;

  -- 同一個人的送出一次處理一個，洗版計數才準
  perform pg_advisory_xact_lock(hashtext('send:' || uid::text));

  select nickname into nick from public.online_users where user_id = uid;
  if nick is null then
    raise exception 'NOT_JOINED';
  end if;

  if length(body) > 20000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if btrim(body) = '' and p_attachment is null then
    raise exception 'EMPTY_MESSAGE';
  end if;

  if p_attachment is not null then
    if jsonb_typeof(p_attachment) <> 'object'
       or (p_attachment->>'kind') is null
       or (p_attachment->>'kind') not in ('image', 'file')
       or length(coalesce(p_attachment->>'name', '')) not between 1 and 255
       or coalesce(p_attachment->>'size', '') !~ '^[0-9]{1,12}$'
       or coalesce(p_attachment->>'path', '') !~ ('^' || uid::text || '/[0-9a-f-]{36}$')
    then
      raise exception 'ATTACHMENT_INVALID';
    end if;
    if (p_attachment->>'size')::bigint > 10485760 then
      raise exception 'FILE_TOO_LARGE';
    end if;
    -- 只留下我們認得的欄位
    att := jsonb_build_object(
      'kind', p_attachment->>'kind',
      'name', p_attachment->>'name',
      'size', (p_attachment->>'size')::bigint,
      'mime', left(coalesce(p_attachment->>'mime', ''), 100),
      'path', p_attachment->>'path'
    );
  end if;

  select count(*) into recent
  from public.messages
  where author_id = uid
    and kind = 'chat'
    and created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.messages (kind, author_id, nickname, content, attachment)
  values ('chat', uid, nick, body, att)
  returning * into msg;

  return msg;
end;
$$;

-- ---------------------------------------------------------------
-- 修改自己的訊息
-- ---------------------------------------------------------------
create or replace function public.edit_message(p_id bigint, p_content text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  msg  public.messages;
  body text := coalesce(p_content, '');
begin
  select * into msg from public.messages where id = p_id for update;
  if not found or msg.kind <> 'chat' then
    raise exception 'NOT_FOUND';
  end if;
  if msg.author_id is distinct from uid then
    raise exception 'NOT_OWNER';
  end if;
  if msg.deleted_at is not null then
    raise exception 'ALREADY_DELETED';
  end if;
  if msg.hidden then
    raise exception 'MESSAGE_HIDDEN';
  end if;
  if length(body) > 20000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if btrim(body) = '' and msg.attachment is null then
    raise exception 'EMPTY_MESSAGE';
  end if;

  update public.messages
  set content = body, edited_at = now()
  where id = p_id
  returning * into msg;

  return msg;
end;
$$;

-- ---------------------------------------------------------------
-- 刪除自己的訊息（內容與附件資訊一併清空）
-- ---------------------------------------------------------------
create or replace function public.delete_message(p_id bigint)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  msg public.messages;
begin
  select * into msg from public.messages where id = p_id for update;
  if not found or msg.kind <> 'chat' then
    raise exception 'NOT_FOUND';
  end if;
  if msg.author_id is distinct from uid then
    raise exception 'NOT_OWNER';
  end if;

  delete from public.hidden_contents where message_id = p_id;

  update public.messages
  set deleted_at = coalesce(deleted_at, now()),
      content = '',
      attachment = null
  where id = p_id
  returning * into msg;

  return msg;
end;
$$;

-- ---------------------------------------------------------------
-- 檢舉：不能檢舉自己、同一人同一則只算一次；累計 3 個不同的人就自動隱藏
-- 隱藏時原文搬進 hidden_contents，messages 裡只剩空白，前端查不到
-- ---------------------------------------------------------------
create or replace function public.report_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  msg      public.messages;
  inserted int;
  n        int;
begin
  if uid is null or not exists (select 1 from public.online_users where user_id = uid) then
    raise exception 'NOT_JOINED';
  end if;

  select * into msg from public.messages where id = p_id for update;
  if not found or msg.kind <> 'chat' then
    raise exception 'NOT_FOUND';
  end if;
  if msg.author_id is not distinct from uid then
    raise exception 'OWN_MESSAGE';
  end if;
  if msg.deleted_at is not null then
    raise exception 'ALREADY_DELETED';
  end if;

  insert into public.reports (message_id, reporter_id)
  values (p_id, uid)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    raise exception 'ALREADY_REPORTED';
  end if;

  select count(*) into n from public.reports where message_id = p_id;

  if n >= 3 and not msg.hidden and not msg.approved then
    insert into public.hidden_contents (message_id, content, attachment)
    values (p_id, msg.content, msg.attachment)
    on conflict (message_id) do update
      set content = excluded.content, attachment = excluded.attachment;

    update public.messages
    set hidden = true, content = '', attachment = null
    where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 管理者專用（只能在 Supabase 後台的 SQL Editor 執行，前端呼叫不到）
-- ---------------------------------------------------------------

-- 恢復被自動隱藏的訊息，並標記「管理者已確認」，之後不再被自動隱藏
create or replace function public.admin_restore_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.hidden_contents;
begin
  select * into h from public.hidden_contents where message_id = p_id;
  if found then
    update public.messages
    set hidden = false, approved = true, content = h.content, attachment = h.attachment
    where id = p_id;
    delete from public.hidden_contents where message_id = p_id;
  else
    update public.messages set approved = true where id = p_id;
  end if;
end;
$$;

-- 刪除訊息（顯示成「此訊息已刪除」）
create or replace function public.admin_delete_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.hidden_contents where message_id = p_id;
  update public.messages
  set deleted_at = coalesce(deleted_at, now()), hidden = false, content = '', attachment = null
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------
-- 誰能呼叫：先收回所有人，再只開放給「已匿名登入」的使用者
-- ---------------------------------------------------------------
revoke all on function public.sweep_stale_users()                  from public, anon, authenticated;
revoke all on function public.claim_nickname(text)                 from public, anon, authenticated;
revoke all on function public.heartbeat()                          from public, anon, authenticated;
revoke all on function public.leave_room()                         from public, anon, authenticated;
revoke all on function public.send_message(text, jsonb)            from public, anon, authenticated;
revoke all on function public.edit_message(bigint, text)           from public, anon, authenticated;
revoke all on function public.delete_message(bigint)               from public, anon, authenticated;
revoke all on function public.report_message(bigint)               from public, anon, authenticated;
revoke all on function public.admin_restore_message(bigint)        from public, anon, authenticated;
revoke all on function public.admin_delete_message(bigint)         from public, anon, authenticated;

grant execute on function public.claim_nickname(text)              to authenticated;
grant execute on function public.heartbeat()                       to authenticated;
grant execute on function public.leave_room()                      to authenticated;
grant execute on function public.send_message(text, jsonb)         to authenticated;
grant execute on function public.edit_message(bigint, text)        to authenticated;
grant execute on function public.delete_message(bigint)            to authenticated;
grant execute on function public.report_message(bigint)            to authenticated;
-- sweep_stale_users、admin_* 不開放給前端
