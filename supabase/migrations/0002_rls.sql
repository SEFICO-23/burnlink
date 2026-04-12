-- burnlink 0002: row level security
-- All writes go through the service role from trusted server routes.
-- Clients (dashboard) only ever read, and only if their JWT email matches app_config.operator_email.

create table if not exists app_config (
  id             int primary key default 1 check (id = 1),
  operator_email text not null
);

alter table app_config    enable row level security;
alter table bots          enable row level security;
alter table invite_links  enable row level security;
alter table clicks        enable row level security;
alter table joins         enable row level security;
alter table capi_events   enable row level security;
alter table ops_log       enable row level security;

create or replace function is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_config
    where operator_email = coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
      ''
    )
  );
$$;

-- Read-only policies for the operator. No insert/update/delete from clients.
do $$
declare t text;
begin
  for t in select unnest(array[
    'bots','invite_links','clicks','joins','capi_events','ops_log','app_config'
  ]) loop
    execute format('drop policy if exists "operator_read" on %I', t);
    execute format(
      'create policy "operator_read" on %I for select using (is_operator())',
      t
    );
  end loop;
end $$;

-- Pool health view inherits the underlying table policies in Supabase
grant select on pool_health_vw to anon, authenticated;
