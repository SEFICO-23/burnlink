-- burnlink 0001: schema

create extension if not exists "pgcrypto";

create table if not exists bots (
  id          uuid primary key default gen_random_uuid(),
  username    text not null,
  token       text not null,
  channel_id  bigint not null,
  is_active   boolean not null default true,
  last_error  text,
  last_refill_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists clicks (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  fbclid           text,
  fbc              text,
  fbp              text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  ip               inet,
  user_agent       text,
  country          text,
  assigned_link_id uuid,
  event_id         uuid not null default gen_random_uuid()
);
create index if not exists clicks_received_at_idx on clicks (received_at desc);
create index if not exists clicks_utm_campaign_idx on clicks (utm_campaign);

create table if not exists invite_links (
  id                 uuid primary key default gen_random_uuid(),
  bot_id             uuid not null references bots(id) on delete cascade,
  invite_link        text not null unique,
  telegram_name      text not null,
  status             text not null check (status in ('unused','reserved','burned','expired','revoked')),
  reserved_click_id  uuid references clicks(id) on delete set null,
  created_at         timestamptz not null default now(),
  reserved_at        timestamptz,
  burned_at          timestamptz
);
create index if not exists invite_links_pool_idx on invite_links (bot_id, status) where status = 'unused';
create index if not exists invite_links_status_idx on invite_links (status);

-- Add the click->link FK now that invite_links exists
alter table clicks
  add constraint clicks_assigned_link_fk
  foreign key (assigned_link_id) references invite_links(id) on delete set null;

create table if not exists joins (
  id               uuid primary key default gen_random_uuid(),
  click_id         uuid references clicks(id) on delete set null,
  invite_link_id   uuid not null references invite_links(id) on delete cascade,
  telegram_user_id bigint not null,
  joined_at        timestamptz not null default now(),
  event_id         uuid not null default gen_random_uuid()
);
create index if not exists joins_joined_at_idx on joins (joined_at desc);

create table if not exists capi_events (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('PageView','Lead')),
  click_id     uuid references clicks(id) on delete set null,
  join_id      uuid references joins(id) on delete set null,
  event_id     uuid not null,
  request_body jsonb not null,
  response     jsonb,
  http_status  int,
  fired_at     timestamptz not null default now()
);
create index if not exists capi_events_fired_idx on capi_events (fired_at desc);
create index if not exists capi_events_kind_idx on capi_events (kind, http_status);

create table if not exists ops_log (
  id      bigserial primary key,
  level   text not null check (level in ('info','warn','error')),
  source  text not null,
  message text not null,
  context jsonb,
  at      timestamptz not null default now()
);
create index if not exists ops_log_at_idx on ops_log (at desc);

create or replace view pool_health_vw as
select
  b.id        as bot_id,
  b.username,
  b.is_active,
  b.last_refill_at,
  b.last_error,
  coalesce(sum(case when il.status = 'unused'   then 1 else 0 end), 0)::int as unused,
  coalesce(sum(case when il.status = 'reserved' then 1 else 0 end), 0)::int as reserved,
  coalesce(sum(case when il.status = 'burned'   then 1 else 0 end), 0)::int as burned
from bots b
left join invite_links il on il.bot_id = b.id
group by b.id;
