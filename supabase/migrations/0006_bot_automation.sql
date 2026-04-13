-- burnlink 0006: bot automation
-- Adds: out_clicks table, welcome_messages table,
-- affiliate_url + telegram_chat_id on user_settings

-- ============================================================
-- 1. New columns on user_settings
-- ============================================================
alter table user_settings add column if not exists affiliate_url text;
alter table user_settings add column if not exists telegram_chat_id bigint;

-- ============================================================
-- 2. out_clicks table
-- ============================================================
create table if not exists out_clicks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  join_id       uuid references joins(id) on delete set null,
  click_id      uuid references clicks(id) on delete set null,
  event_id      text not null default gen_random_uuid()::text,
  affiliate_url text not null,
  ip            inet,
  user_agent    text,
  country       text,
  created_at    timestamptz not null default now()
);
create index if not exists out_clicks_user_id_idx on out_clicks (user_id);
create index if not exists out_clicks_created_at_idx on out_clicks (created_at desc);

-- RLS
alter table out_clicks enable row level security;
create policy "user_out_clicks_read" on out_clicks
  for select using (user_id = auth.uid());

-- ============================================================
-- 3. welcome_messages table
-- ============================================================
create table if not exists welcome_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bot_id      uuid not null references bots(id) on delete cascade,
  channel_id  bigint not null,
  message     text not null default 'Welcome! {out_link}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(bot_id, channel_id)
);
create index if not exists welcome_messages_user_id_idx on welcome_messages (user_id);

-- RLS
alter table welcome_messages enable row level security;
create policy "user_wm_read" on welcome_messages
  for select using (user_id = auth.uid());
create policy "user_wm_insert" on welcome_messages
  for insert with check (user_id = auth.uid());
create policy "user_wm_update" on welcome_messages
  for update using (user_id = auth.uid());
create policy "user_wm_delete" on welcome_messages
  for delete using (user_id = auth.uid());

-- ============================================================
-- 4. Update capi_events check constraint for new event kind
-- ============================================================
alter table capi_events drop constraint if exists capi_events_kind_check;
alter table capi_events add constraint capi_events_kind_check
  check (kind in ('PageView', 'Lead', 'InitiateCheckout'));

-- ============================================================
-- 5. Expand ops_log source enum for new sources
-- ============================================================
-- ops_log.source is just text, no check constraint — no change needed.

-- ============================================================
-- 6. Grant access
-- ============================================================
grant select on out_clicks to authenticated;
grant select, insert, update, delete on welcome_messages to authenticated;
