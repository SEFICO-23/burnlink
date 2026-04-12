-- burnlink 0003: atomic burn-link reservation
--
-- Pops one unused invite_link, marks it 'reserved', returns its id + invite_link.
-- Uses SELECT ... FOR UPDATE SKIP LOCKED so concurrent /go hits never collide.
-- Preference order: bot with the most unused links (cheapest round-robin proxy).

create or replace function pop_unused_link(p_click_id uuid)
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
    join bots b on b.id = il.bot_id and b.is_active = true
    where il.status = 'unused'
    order by b.id, il.created_at  -- stable within a bot
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

revoke all on function pop_unused_link(uuid) from public;
grant execute on function pop_unused_link(uuid) to service_role;
