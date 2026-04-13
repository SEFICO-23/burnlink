-- burnlink 0005: multi-tenant support
-- Adds user_id ownership to all tables, creates user_settings,
-- rewrites RLS from single-operator to per-user, updates pop_unused_link.

-- ============================================================
-- 1. Create user_settings table
-- ============================================================
create table if not exists user_settings (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  slug          text unique not null,
  fb_pixel_id   text,
  fb_capi_token text,
  fb_test_code  text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists user_settings_slug_idx on user_settings (slug);

-- Seed the existing operator as admin
insert into user_settings (id, display_name, slug, is_admin)
select id, 'Operator', 'default', true
from auth.users
where email = 'wordlw82@gmail.com'
limit 1
on conflict (id) do nothing;

-- ============================================================
-- 2. Add user_id columns (nullable for backfill)
-- ============================================================
alter table bots        add column if not exists user_id uuid references auth.users(id);
alter table clicks      add column if not exists user_id uuid references auth.users(id);
alter table joins       add column if not exists user_id uuid references auth.users(id);
alter table capi_events add column if not exists user_id uuid references auth.users(id);
alter table ops_log     add column if not exists user_id uuid references auth.users(id); -- stays nullable

-- ============================================================
-- 3. Backfill existing data to operator's user_id
-- ============================================================
do $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where email = 'wordlw82@gmail.com' limit 1;
  if v_uid is null then
    raise notice 'No operator user found — skipping backfill';
    return;
  end if;

  update bots        set user_id = v_uid where user_id is null;
  update clicks      set user_id = v_uid where user_id is null;
  update joins       set user_id = v_uid where user_id is null;
  update capi_events set user_id = v_uid where user_id is null;
  update ops_log     set user_id = v_uid where user_id is null;
end $$;

-- ============================================================
-- 4. Make user_id NOT NULL (except ops_log)
-- ============================================================
alter table bots        alter column user_id set not null;
alter table clicks      alter column user_id set not null;
alter table joins       alter column user_id set not null;
alter table capi_events alter column user_id set not null;
-- ops_log.user_id stays nullable (system events have no user)

-- Add indexes for user-scoped queries
create index if not exists bots_user_id_idx        on bots (user_id);
create index if not exists clicks_user_id_idx      on clicks (user_id);
create index if not exists joins_user_id_idx       on joins (user_id);
create index if not exists capi_events_user_id_idx on capi_events (user_id);

-- ============================================================
-- 5. Rewrite RLS policies
-- ============================================================
-- Drop old operator-based policies
do $$
declare t text;
begin
  for t in select unnest(array[
    'bots','invite_links','clicks','joins','capi_events','ops_log','app_config'
  ]) loop
    execute format('drop policy if exists "operator_read" on %I', t);
  end loop;
end $$;

-- Drop the old function and table
drop function if exists is_operator();
drop table if exists app_config;

-- Enable RLS on user_settings
alter table user_settings enable row level security;

-- user_settings: users read/update own row; admins read all
create policy "own_settings_read" on user_settings
  for select using (auth.uid() = id);
create policy "own_settings_update" on user_settings
  for update using (auth.uid() = id);
create policy "admin_read_all_settings" on user_settings
  for select using (
    exists (select 1 from user_settings where id = auth.uid() and is_admin = true)
  );

-- bots: user sees own bots
create policy "user_bots_read" on bots
  for select using (user_id = auth.uid());

-- clicks: user sees own clicks
create policy "user_clicks_read" on clicks
  for select using (user_id = auth.uid());

-- joins: user sees own joins
create policy "user_joins_read" on joins
  for select using (user_id = auth.uid());

-- capi_events: user sees own events
create policy "user_capi_read" on capi_events
  for select using (user_id = auth.uid());

-- ops_log: user sees own logs (or null user_id for system events visible to admins)
create policy "user_ops_read" on ops_log
  for select using (
    user_id = auth.uid()
    or (user_id is null and exists (
      select 1 from user_settings where id = auth.uid() and is_admin = true
    ))
  );

-- invite_links: user sees links belonging to their bots
create policy "user_links_read" on invite_links
  for select using (
    exists (select 1 from bots where bots.id = invite_links.bot_id and bots.user_id = auth.uid())
  );

-- Grant view access
grant select on user_settings to anon, authenticated;
grant select on pool_health_vw to anon, authenticated;

-- ============================================================
-- 6. Update pop_unused_link — add p_user_id parameter
-- ============================================================
-- Drop old function signature first
drop function if exists pop_unused_link(uuid);

create or replace function pop_unused_link(p_click_id uuid, p_user_id uuid)
returns table (link_id uuid, invite_link text, bot_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
  v_invite  text;
  v_bot     uuid;
begin
  with target as (
    select il.id, il.invite_link, il.bot_id
    from invite_links il
    join bots b on b.id = il.bot_id and b.is_active = true and b.user_id = p_user_id
    where il.status = 'unused'
    order by b.id, il.created_at
    for update of il skip locked
    limit 1
  )
  update invite_links il
     set status           = 'reserved',
         reserved_at      = now(),
         reserved_click_id= p_click_id
    from target
   where il.id = target.id
  returning il.id, il.invite_link, il.bot_id
    into v_link_id, v_invite, v_bot;

  if v_link_id is null then
    return;
  end if;

  return query select v_link_id, v_invite, v_bot;
end;
$$;

revoke all on function pop_unused_link(uuid, uuid) from public;
grant execute on function pop_unused_link(uuid, uuid) to service_role;

-- ============================================================
-- 7. Update pool_health_vw — add user_id
-- ============================================================
drop view if exists pool_health_vw;
create view pool_health_vw as
select
  b.id        as bot_id,
  b.username,
  b.channel_id,
  b.telegram_id,
  b.user_id,
  b.is_active,
  b.last_refill_at,
  b.last_error,
  coalesce(sum(case when il.status = 'unused'   then 1 else 0 end), 0)::int as unused,
  coalesce(sum(case when il.status = 'reserved' then 1 else 0 end), 0)::int as reserved,
  coalesce(sum(case when il.status = 'burned'   then 1 else 0 end), 0)::int as burned
from bots b
left join invite_links il on il.bot_id = b.id
group by b.id;
