-- burnlink 0004: auto-discovery support
-- Makes channel_id nullable (bot can exist before any channel is discovered)
-- Adds telegram_id for reverse-lookup on my_chat_member webhooks

alter table bots alter column channel_id drop not null;

alter table bots add column if not exists telegram_id bigint;

-- Prevent duplicate bot-channel pairs (only when both are known)
create unique index if not exists bots_tgid_channel_uq
  on bots (telegram_id, channel_id)
  where telegram_id is not null and channel_id is not null;

-- Update pool_health_vw to show channel_id and filter out pending bots
create or replace view pool_health_vw as
select
  b.id        as bot_id,
  b.username,
  b.channel_id,
  b.telegram_id,
  b.is_active,
  b.last_refill_at,
  b.last_error,
  coalesce(sum(case when il.status = 'unused'   then 1 else 0 end), 0)::int as unused,
  coalesce(sum(case when il.status = 'reserved' then 1 else 0 end), 0)::int as reserved,
  coalesce(sum(case when il.status = 'burned'   then 1 else 0 end), 0)::int as burned
from bots b
left join invite_links il on il.bot_id = b.id
group by b.id;
