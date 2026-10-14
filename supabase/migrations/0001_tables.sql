-- 0001：建立四張資料表，並鎖住權限。
-- 可以重複執行（已經存在的東西會被略過或更新）。

-- ---------------------------------------------------------------
-- 訊息表：所有訊息，包含「某某進入／離開」的系統訊息
-- ---------------------------------------------------------------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('chat', 'join', 'leave')),
  author_id   uuid,                                   -- 送出者的匿名身分編號
  nickname    text not null check (nickname ~ '^[A-Za-z0-9一-鿿]{1,12}$'),
  content     text not null default '' check (length(content) <= 20000),
  attachment  jsonb,                                  -- {kind, name, size, mime, path}
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  hidden      boolean not null default false,         -- 多人檢舉後自動隱藏
  approved    boolean not null default false,         -- 管理者確認過，不再被自動隱藏
  -- 一般訊息至少要有文字或附件（已刪除、已隱藏的除外）
  constraint messages_chat_not_empty check (
    kind <> 'chat'
    or deleted_at is not null
    or hidden
    or length(btrim(content)) > 0
    or attachment is not null
  )
);

-- 洗版限制要查「這個人最近 10 秒送了幾則」
create index if not exists messages_author_recent
  on public.messages (author_id, created_at desc)
  where kind = 'chat';

-- ---------------------------------------------------------------
-- 線上名單表：目前在線的人。代號不分大小寫，不可重複
-- ---------------------------------------------------------------
create table if not exists public.online_users (
  nickname   text primary key check (nickname ~ '^[A-Za-z0-9一-鿿]{1,12}$'),
  user_id    uuid not null,
  last_seen  timestamptz not null default now()
);

create unique index if not exists online_users_nickname_lower
  on public.online_users (lower(nickname));

-- 一個人同一時間只能佔用一個代號
create unique index if not exists online_users_user_id
  on public.online_users (user_id);

-- ---------------------------------------------------------------
-- 檢舉表：同一人對同一則只能有一筆
-- ---------------------------------------------------------------
create table if not exists public.reports (
  message_id   bigint not null references public.messages (id) on delete cascade,
  reporter_id  uuid not null,
  created_at   timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

-- ---------------------------------------------------------------
-- 隱藏內容表：被自動隱藏的訊息的原文（前端完全讀不到）
-- ---------------------------------------------------------------
create table if not exists public.hidden_contents (
  message_id  bigint primary key references public.messages (id) on delete cascade,
  content     text not null,
  attachment  jsonb,
  hidden_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 權限：四張表都啟用 RLS（資料列安全規則），並收回所有人的直接寫入權
-- 前端只能「讀」訊息和線上名單；所有寫入都得經過 0002 的資料庫函式
-- ---------------------------------------------------------------
alter table public.messages        enable row level security;
alter table public.online_users    enable row level security;
alter table public.reports         enable row level security;
alter table public.hidden_contents enable row level security;

revoke all on public.messages        from anon, authenticated;
revoke all on public.online_users    from anon, authenticated;
revoke all on public.reports         from anon, authenticated;
revoke all on public.hidden_contents from anon, authenticated;

grant select on public.messages     to authenticated;
grant select on public.online_users to authenticated;

drop policy if exists "messages_read" on public.messages;
create policy "messages_read" on public.messages
  for select to authenticated using (true);

drop policy if exists "online_users_read" on public.online_users;
create policy "online_users_read" on public.online_users
  for select to authenticated using (true);

-- reports、hidden_contents 沒有任何 policy = 前端完全不能讀寫（管理者在後台可看）
