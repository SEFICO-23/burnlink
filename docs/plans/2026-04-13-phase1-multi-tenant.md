# Phase 1: Multi-Tenant Core — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user_id ownership to all tables, per-user FB credentials, scoped `/go` routing via `?uid=slug`, and open magic-link auth — turning burnlink from single-operator into multi-tenant.

**Architecture:** Every data table gets a `user_id` FK. A new `user_settings` table holds per-user FB Pixel credentials and a unique slug used in `/go?uid=<slug>`. RLS policies enforce tenant isolation. `fireCapi()` becomes parameterized instead of reading env vars. The `/go` route resolves slug → user → pool → CAPI credentials at request time.

**Tech Stack:** Next.js 15, Supabase Postgres (RLS, auth.users), Tailwind CSS

**Design doc:** `docs/plans/2026-04-13-multi-tenant-saas-design.md`

---

## Important Context

- **Existing production data:** 3 legacy bots + 1 auto-discovered bot, ~4000 invite links, operator email `wordlw82@gmail.com`. All must be backfilled with user_id.
- **`app_config` table:** Currently holds operator_email for RLS. Will be dropped — replaced by `user_settings`.
- **`OPERATOR_EMAIL` env var:** Currently used in middleware, auth/callback, dashboard layout, bots API. All references must be removed.
- **`FB_PIXEL_ID` / `FB_CAPI_ACCESS_TOKEN` env vars:** Currently used by `lib/capi.ts`. After migration, credentials live in `user_settings`. Env vars become fallback (for backward compat during transition) then are removed.
- **Supabase `auth.users`:** We can reference it in migrations via `auth.users` table. The operator's UUID is looked up by email.

---

### Task 1: Database Migration 0005 — Multi-Tenant Schema

**Files:**
- Create: `supabase/migrations/0005_multi_tenant.sql`

**Step 1: Write the migration**

This is the biggest single migration in the project. It must be run in the Supabase SQL editor.

```sql
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
```

**Step 2: Run in Supabase SQL editor**

Paste the full migration. Verify:
```sql
select * from user_settings;
-- Expect: 1 row for operator with is_admin=true, slug='default'

select count(*) from bots where user_id is null;
-- Expect: 0

select * from information_schema.columns
where table_name = 'bots' and column_name = 'user_id';
-- Expect: is_nullable = 'NO'
```

**Step 3: Commit**

```bash
git add supabase/migrations/0005_multi_tenant.sql
git commit -m "feat: migration 0005 — multi-tenant schema, RLS, scoped pop_unused_link"
```

---

### Task 2: Backfill FB Credentials Into `user_settings`

**Files:**
- Create: `scripts/backfill-fb-credentials.mjs`

**Step 1: Write the script**

Same pattern as existing scripts (reads .env.local, uses service client):

```javascript
// Backfill FB_PIXEL_ID and FB_CAPI_ACCESS_TOKEN into user_settings for the operator.
// Run once: `node scripts/backfill-fb-credentials.mjs`
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- Load .env.local ---
try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
} catch (e) {
  console.error('FAIL: could not read .env.local:', e.message);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pixelId = process.env.FB_PIXEL_ID;
const capiToken = process.env.FB_CAPI_ACCESS_TOKEN;
const testCode = process.env.FB_TEST_EVENT_CODE || null;

if (!url || !serviceKey) {
  console.error('FAIL: missing Supabase env vars');
  process.exit(1);
}
if (!pixelId || !capiToken) {
  console.error('FAIL: missing FB_PIXEL_ID or FB_CAPI_ACCESS_TOKEN');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from('user_settings')
  .update({ fb_pixel_id: pixelId, fb_capi_token: capiToken, fb_test_code: testCode })
  .eq('is_admin', true)
  .select('id, slug, fb_pixel_id')
  .single();

if (error) {
  console.error('FAIL:', error.message);
  process.exit(1);
}

console.log('OK: backfilled FB credentials for admin user');
console.log('  slug:', data.slug);
console.log('  fb_pixel_id:', data.fb_pixel_id);
process.exit(0);
```

**Step 2: Run the script**

```bash
node scripts/backfill-fb-credentials.mjs
```
Expected: `OK: backfilled FB credentials for admin user`

**Step 3: Commit**

```bash
git add scripts/backfill-fb-credentials.mjs
git commit -m "chore: script to backfill FB credentials into user_settings"
```

---

### Task 3: Update `lib/capi.ts` — Parameterized Credentials

**Files:**
- Modify: `lib/capi.ts:85-112` (fireCapi function)

**Step 1: Add credentials parameter to fireCapi**

Add an optional `credentials` parameter. If provided, use it. If not, fall back to env vars (for backward compat during transition).

Change the `fireCapi` function signature and body:

```typescript
export interface CapiCredentials {
  pixel_id: string;
  access_token: string;
  test_event_code?: string | null;
}

export async function fireCapi(
  input: CapiEventInput,
  credentials?: CapiCredentials,
): Promise<{
  status: number;
  body: unknown;
  request: unknown;
}> {
  const pixelId = credentials?.pixel_id ?? process.env.FB_PIXEL_ID;
  const token = credentials?.access_token ?? process.env.FB_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    return {
      status: 0,
      body: { error: "FB credentials not configured" },
      request: input,
    };
  }

  const payload = await buildCapiPayload(input, credentials?.test_event_code);
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(
    token,
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, request: payload };
}
```

Also update `buildCapiPayload` to accept an optional test_event_code param instead of reading env:

```typescript
export async function buildCapiPayload(input: CapiEventInput, testEventCode?: string | null) {
  // ... existing body ...
  return {
    data: [/* ... */],
    ...(testEventCode ?? process.env.FB_TEST_EVENT_CODE
      ? { test_event_code: testEventCode ?? process.env.FB_TEST_EVENT_CODE }
      : {}),
  };
}
```

**Step 2: Verify build**

```bash
npx next build
```
Expected: passes (existing callers still work via env var fallback).

**Step 3: Commit**

```bash
git add lib/capi.ts
git commit -m "feat: fireCapi accepts per-user credentials, falls back to env vars"
```

---

### Task 4: Update `/go` Route — Slug Lookup + User-Scoped Pop

**Files:**
- Modify: `app/go/route.ts`

**Step 1: Rewrite the GET handler**

The route now:
1. Reads `uid` from query params
2. Looks up `user_settings` by slug
3. Inserts click with `user_id`
4. Calls `pop_unused_link(click_id, user_id)`
5. Fires CAPI with user's credentials

```typescript
export async function GET(req: NextRequest) {
  const ctx = extractClickContext(req);
  const sb = serviceClient();

  // Resolve user from slug
  const uid = new URL(req.url).searchParams.get("uid");
  if (!uid) {
    return NextResponse.json({ error: "missing uid parameter" }, { status: 400 });
  }

  const { data: user } = await sb
    .from("user_settings")
    .select("id, fb_pixel_id, fb_capi_token, fb_test_code")
    .eq("slug", uid)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "invalid uid" }, { status: 404 });
  }

  const { data: click, error: clickErr } = await sb
    .from("clicks")
    .insert({
      user_id: user.id,
      fbclid: ctx.fbclid,
      fbc: ctx.fbc,
      fbp: ctx.fbp,
      utm_source: ctx.utm_source,
      utm_medium: ctx.utm_medium,
      utm_campaign: ctx.utm_campaign,
      utm_content: ctx.utm_content,
      utm_term: ctx.utm_term,
      ip: ctx.ip,
      user_agent: ctx.user_agent,
      country: ctx.country,
    })
    .select("id, event_id")
    .single();

  if (clickErr || !click) {
    await logOps("error", "go", "click insert failed", { error: clickErr?.message, user_id: user.id });
    return NextResponse.redirect(new URL("/sold-out", req.url), 302);
  }

  // Scoped pop — only this user's bots' pools
  const { data: popped, error: popErr } = await sb.rpc("pop_unused_link", {
    p_click_id: click.id,
    p_user_id: user.id,
  });

  if (popErr) {
    await logOps("error", "go", "pop_unused_link rpc failed", {
      click_id: click.id,
      user_id: user.id,
      error: popErr.message,
    });
    return NextResponse.redirect(new URL("/sold-out", req.url), 302);
  }

  const row = Array.isArray(popped) ? popped[0] : popped;
  if (!row?.invite_link) {
    await logOps("warn", "go", "pool empty", { click_id: click.id, user_id: user.id });
    return NextResponse.redirect(new URL("/sold-out", req.url), 302);
  }

  await sb
    .from("clicks")
    .update({ assigned_link_id: row.link_id })
    .eq("id", click.id);

  // Fire-and-forget CAPI PageView with user's credentials
  after(async () => {
    const creds = user.fb_pixel_id && user.fb_capi_token
      ? { pixel_id: user.fb_pixel_id, access_token: user.fb_capi_token, test_event_code: user.fb_test_code }
      : undefined;

    if (!creds) {
      await logOps("warn", "capi", "PageView skipped — user has no FB credentials", { user_id: user.id });
      return;
    }

    try {
      const result = await fireCapi({
        kind: "PageView",
        event_id: click.event_id,
        event_source_url: ctx.event_source_url,
        action_source: "website",
        user_data: {
          fbclid: ctx.fbclid,
          fbc: ctx.fbc,
          fbp: ctx.fbp,
          client_ip_address: ctx.ip,
          client_user_agent: ctx.user_agent,
          country: ctx.country,
        },
      }, creds);
      await sb.from("capi_events").insert({
        kind: "PageView",
        click_id: click.id,
        user_id: user.id,
        event_id: click.event_id,
        request_body: result.request as object,
        response: result.body as object,
        http_status: result.status,
      });
    } catch (e) {
      await logOps("error", "capi", "PageView fire failed", {
        click_id: click.id,
        user_id: user.id,
        error: (e as Error).message,
      });
    }
  });

  return NextResponse.redirect(row.invite_link, 302);
}
```

**Step 2: Verify build**

```bash
npx next build
```

**Step 3: Commit**

```bash
git add app/go/route.ts
git commit -m "feat: /go resolves slug to user, scoped pool pop, per-user CAPI"
```

---

### Task 5: Update Webhook Handler — Per-User CAPI Credentials

**Files:**
- Modify: `app/api/telegram/webhook/[secret]/route.ts:126-156` (CAPI Lead section)

**Step 1: Look up user credentials via bot → user_settings**

After the existing `link` lookup (line 80-88), add a user lookup. In the CAPI Lead section, replace env-var-based `fireCapi` with per-user credentials.

Insert after the `click` lookup (around line 96-104), before the `joins` insert:

```typescript
// Look up the bot's owner for CAPI credentials
const { data: botRow } = await sb
  .from("bots")
  .select("user_id")
  .eq("id", link.bot_id)
  .maybeSingle();

const { data: owner } = botRow?.user_id
  ? await sb
      .from("user_settings")
      .select("id, fb_pixel_id, fb_capi_token, fb_test_code")
      .eq("id", botRow.user_id)
      .maybeSingle()
  : { data: null };
```

Update the `joins` insert to include `user_id`:

```typescript
const { data: joinRow, error: joinErr } = await sb
  .from("joins")
  .insert({
    click_id: click?.id ?? null,
    invite_link_id: link.id,
    telegram_user_id: cm.new_chat_member.user.id,
    user_id: botRow?.user_id ?? null,
  })
  .select("id, event_id")
  .single();
```

Update the `fireCapi` call to use owner's credentials:

```typescript
const creds = owner?.fb_pixel_id && owner?.fb_capi_token
  ? { pixel_id: owner.fb_pixel_id, access_token: owner.fb_capi_token, test_event_code: owner.fb_test_code }
  : undefined;

if (!creds) {
  await logOps("warn", "capi", "Lead skipped — bot owner has no FB credentials", {
    join_id: joinRow.id,
    user_id: botRow?.user_id,
  });
} else {
  try {
    const result = await fireCapi({ /* existing params */ }, creds);
    await sb.from("capi_events").insert({
      kind: "Lead",
      click_id: click?.id ?? null,
      join_id: joinRow.id,
      user_id: botRow?.user_id ?? null,
      event_id: joinRow.event_id,
      request_body: result.request as object,
      response: result.body as object,
      http_status: result.status,
    });
  } catch (e) {
    await logOps("error", "capi", "Lead fire failed", {
      join_id: joinRow.id,
      error: (e as Error).message,
    });
  }
}
```

**Step 2: Verify build**

```bash
npx next build
```

**Step 3: Commit**

```bash
git add app/api/telegram/webhook/[secret]/route.ts
git commit -m "feat: webhook fires CAPI Lead with bot owner's credentials"
```

---

### Task 6: Update Bot-Add API — User-Scoped

**Files:**
- Modify: `app/api/bots/route.ts`

**Step 1: Replace requireOperator with session-based auth**

Replace the `requireOperator()` function:

```typescript
async function requireAuth() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return data.user;
}
```

In POST handler, change:
- `await requireOperator()` → `await requireAuth()`
- Insert bot with `user_id: user.id`
- Remove `OPERATOR_EMAIL` check

In DELETE handler, same auth change. Also verify the bot belongs to the user:

```typescript
// Verify ownership
const sb = serviceClient();
const { data: bot } = await sb.from("bots").select("user_id").eq("id", id).maybeSingle();
if (!bot || bot.user_id !== user.id) {
  return NextResponse.json({ ok: false }, { status: 404 });
}
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/api/bots/route.ts
git commit -m "feat: bot-add API uses session auth, sets user_id on bot"
```

---

### Task 7: Update Auth Callback — Remove Operator Gate, Add Onboarding Redirect

**Files:**
- Modify: `app/auth/callback/route.ts`

**Step 1: Rewrite callback**

Remove the `OPERATOR_EMAIL` check. After exchanging code for session, check if user has `user_settings`. If not, redirect to `/onboarding`.

```typescript
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", req.url));

  const store = await cookies();
  const res = NextResponse.redirect(new URL("/dashboard", req.url));

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items: CookieSetItem[]) => {
          items.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=1", req.url));

  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", req.url));

  // Check if user has completed onboarding
  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!settings) {
    // New user — redirect to onboarding
    const onboard = new URL("/onboarding", req.url);
    // Copy cookies to the onboarding redirect
    const onboardRes = NextResponse.redirect(onboard);
    res.cookies.getAll().forEach((c) => onboardRes.cookies.set(c.name, c.value));
    return onboardRes;
  }

  return res;
}
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/auth/callback/route.ts
git commit -m "feat: auth callback open to all, redirects new users to onboarding"
```

---

### Task 8: Update Middleware — Remove Operator Check, Add Admin Route

**Files:**
- Modify: `middleware.ts`

**Step 1: Rewrite middleware**

Remove `OPERATOR_EMAIL` check. Add `/admin` route protection. The middleware only checks authentication (session exists). Onboarding check happens in the auth callback and dashboard layout.

```typescript
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = path.startsWith("/dashboard") || path.startsWith("/admin") || path.startsWith("/onboarding");
  if (!isProtected) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (items: CookieSetItem[]) => {
          items.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/onboarding/:path*"],
};
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: middleware protects dashboard + admin + onboarding, no operator check"
```

---

### Task 9: Update Dashboard Layout — Remove Operator Check

**Files:**
- Modify: `app/dashboard/layout.tsx`

**Step 1: Remove OPERATOR_EMAIL check**

The dashboard layout currently checks `data.user.email !== process.env.OPERATOR_EMAIL`. Replace with a check that the user has `user_settings` (i.e., completed onboarding):

```typescript
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    redirect("/login");
  }

  // Check onboarding complete
  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!settings) {
    redirect("/onboarding");
  }

  return (
    // ... existing JSX unchanged, but email display uses data.user.email
  );
}
```

Also add `import { serviceClient } from "@/lib/supabase/server"` if not already imported.

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/dashboard/layout.tsx
git commit -m "feat: dashboard layout checks onboarding, not operator email"
```

---

### Task 10: Update Dashboard Bots Page — Add user_id to Queries

**Files:**
- Modify: `app/dashboard/bots/page.tsx`

**Step 1: Scope query by user**

The server component currently fetches all bots. With RLS, the `rscClient()` query will automatically scope to the user. But the insert in the bot-add API uses `serviceClient()` which bypasses RLS, so we need to pass user_id explicitly there (already done in Task 6). The dashboard read uses `rscClient()` which goes through RLS — no change needed here, but add `user_id` to the select for the client component:

```typescript
const { data } = await sb
  .from("bots")
  .select("id, username, telegram_id, channel_id, is_active, last_refill_at, last_error, created_at")
  .order("created_at", { ascending: false });
```

Actually this already works via RLS. No code change needed — the `rscClient()` runs as the authenticated user and RLS filters automatically.

**Step 2: Verify by checking that the dashboard still loads for the operator**

**Step 3: Commit** (skip if no changes)

---

### Task 11: Create Onboarding Page

**Files:**
- Create: `app/onboarding/page.tsx`

**Step 1: Write the onboarding page**

A simple form: display name, slug (auto-generated), optional FB credentials.

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

function generateSlug() {
  return "bl-" + Math.random().toString(36).slice(2, 8);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(generateSlug());
  const [pixelId, setPixelId] = useState("");
  const [capiToken, setCapiToken] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);

    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: name || null,
        slug,
        fb_pixel_id: pixelId || null,
        fb_capi_token: capiToken || null,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      setState("error");
      setError(body.error ?? "failed");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-panel border border-border rounded-xl p-8 space-y-5"
      >
        <div>
          <h1 className="text-xl font-semibold">Welcome to burnlink</h1>
          <p className="text-sm text-muted mt-1">Set up your account to start tracking.</p>
        </div>

        <label className="block text-xs">
          <span className="text-muted">Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name or brand"
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs">
          <span className="text-muted">Your tracking slug (used in /go?uid=...)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9\-]+"
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <hr className="border-border" />
        <p className="text-xs text-muted">
          Facebook credentials (optional — you can add these later in Settings).
        </p>

        <label className="block text-xs">
          <span className="text-muted">FB Pixel ID</span>
          <input
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value)}
            placeholder="1234567890"
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <label className="block text-xs">
          <span className="text-muted">FB CAPI Access Token</span>
          <input
            type="password"
            value={capiToken}
            onChange={(e) => setCapiToken(e.target.value)}
            placeholder="EAA..."
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={state === "saving"}
          className="w-full bg-accent text-black font-medium rounded px-3 py-2 text-sm disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Continue to dashboard"}
        </button>
        {error && <p className="text-err text-sm">{error}</p>}
      </form>
    </main>
  );
}
```

**Step 2: Create the onboarding API**

- Create: `app/api/onboarding/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    display_name?: string;
    slug?: string;
    fb_pixel_id?: string;
    fb_capi_token?: string;
  } | null;

  if (!body?.slug || !/^[a-z0-9\-]+$/.test(body.slug)) {
    return NextResponse.json(
      { ok: false, error: "slug required (lowercase letters, numbers, hyphens)" },
      { status: 400 },
    );
  }

  const svc = serviceClient();

  // Check slug uniqueness
  const { data: existing } = await svc
    .from("user_settings")
    .select("id")
    .eq("slug", body.slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { ok: false, error: "This slug is already taken" },
      { status: 409 },
    );
  }

  const { error } = await svc.from("user_settings").insert({
    id: auth.user.id,
    display_name: body.display_name || null,
    slug: body.slug,
    fb_pixel_id: body.fb_pixel_id || null,
    fb_capi_token: body.fb_capi_token || null,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

**Step 3: Verify build**

```bash
npx next build
```

**Step 4: Commit**

```bash
git add app/onboarding/page.tsx app/api/onboarding/route.ts
git commit -m "feat: onboarding page + API — new user setup with slug + optional FB creds"
```

---

### Task 12: Create Settings Page

**Files:**
- Create: `app/dashboard/settings/page.tsx`
- Modify: `app/dashboard/layout.tsx` (add Settings tab)

**Step 1: Write the settings page**

```typescript
import { serviceClient, rscClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("slug, display_name, fb_pixel_id, fb_capi_token, fb_test_code")
    .eq("id", auth.user.id)
    .single();

  return <SettingsClient initial={settings} />;
}
```

- Create: `app/dashboard/settings/SettingsClient.tsx`

```typescript
"use client";

import { useState } from "react";

interface Settings {
  slug: string;
  display_name: string | null;
  fb_pixel_id: string | null;
  fb_capi_token: string | null;
  fb_test_code: string | null;
}

export default function SettingsClient({ initial }: { initial: Settings | null }) {
  const [pixelId, setPixelId] = useState(initial?.fb_pixel_id ?? "");
  const [capiToken, setCapiToken] = useState(initial?.fb_capi_token ?? "");
  const [testCode, setTestCode] = useState(initial?.fb_test_code ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const trackingUrl = typeof window !== "undefined"
    ? `${window.location.origin}/go?uid=${initial?.slug ?? ""}`
    : `/go?uid=${initial?.slug ?? ""}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fb_pixel_id: pixelId || null,
        fb_capi_token: capiToken || null,
        fb_test_code: testCode || null,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      setState("error");
      setMsg(body.error ?? "failed");
    } else {
      setState("saved");
      setMsg("Saved.");
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">Tracking URL</h2>
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-xs text-muted mb-2">
            Use this URL as your Facebook ad destination. Add UTM params for campaign breakdown.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm font-mono break-all">
              {trackingUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(trackingUrl)}
              className="bg-accent text-black font-medium rounded px-3 py-2 text-sm whitespace-nowrap"
            >
              Copy
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Facebook CAPI Credentials</h2>
        <form onSubmit={save} className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <label className="block text-xs">
            <span className="text-muted">Pixel ID</span>
            <input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="1234567890"
              className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted">CAPI Access Token</span>
            <input
              type="password"
              value={capiToken}
              onChange={(e) => setCapiToken(e.target.value)}
              placeholder="EAA..."
              className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted">Test Event Code (optional)</span>
            <input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder="TEST12345"
              className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={state === "saving"}
              className="bg-accent text-black font-medium rounded px-4 py-2 text-sm disabled:opacity-60"
            >
              {state === "saving" ? "Saving…" : "Save"}
            </button>
            {msg && <p className="text-xs text-muted">{msg}</p>}
          </div>
        </form>
      </section>
    </div>
  );
}
```

**Step 2: Create settings API**

- Create: `app/api/settings/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    fb_pixel_id?: string | null;
    fb_capi_token?: string | null;
    fb_test_code?: string | null;
  } | null;

  if (!body) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const svc = serviceClient();
  const { error } = await svc
    .from("user_settings")
    .update({
      fb_pixel_id: body.fb_pixel_id,
      fb_capi_token: body.fb_capi_token,
      fb_test_code: body.fb_test_code,
    })
    .eq("id", auth.user.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

**Step 3: Add Settings tab to dashboard layout**

In `app/dashboard/layout.tsx`, add to the `tabs` array:

```typescript
const tabs = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/funnel", label: "Funnel" },
  { href: "/dashboard/pool", label: "Pool" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/bots", label: "Bots" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;
```

**Step 4: Verify build**

```bash
npx next build
```

**Step 5: Commit**

```bash
git add app/dashboard/settings/ app/api/settings/route.ts app/dashboard/layout.tsx
git commit -m "feat: settings page — per-user FB credentials + tracking URL copy"
```

---

### Task 13: Update Login Page — Open to All

**Files:**
- Modify: `app/login/page.tsx`
- Modify: `app/page.tsx`

**Step 1: Update login page copy**

Change "Operator sign-in" to "Sign in" (no longer operator-only). The magic link flow stays the same — it's already open, just the UI text changes.

In `app/login/page.tsx`, change:
- `<p className="text-sm text-muted">Operator sign-in</p>` → `<p className="text-sm text-muted">Sign in with your email</p>`

**Step 2: Update root page redirect**

In `app/page.tsx`, remove the `OPERATOR_EMAIL` check:

```typescript
export default async function Home() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (data.user) {
    redirect("/dashboard");
  }
  redirect("/login");
}
```

(This will later become the landing page in Phase 2, but for now it just redirects.)

**Step 3: Verify build**

**Step 4: Commit**

```bash
git add app/login/page.tsx app/page.tsx
git commit -m "feat: open login, remove operator-only gate from root redirect"
```

---

### Task 14: Verify Build + Smoke Test

**Step 1: Full build**

```bash
npx next build
```
Expected: 0 errors, all routes compile.

**Step 2: Run smoke-db script**

```bash
node scripts/smoke-db.mjs
```
Note: This will fail on the `app_config` check since we dropped that table. Update the script to check `user_settings` instead.

**Step 3: Manual verification**

1. Log in as operator → should land on `/dashboard` (existing user_settings row)
2. Visit `/dashboard/settings` → should show tracking URL with `uid=default`
3. Visit `/dashboard/bots` → should show existing 4 bots
4. Visit `/go?uid=default&fbclid=test123` → should pop link from operator's pool, redirect to t.me
5. Check `clicks` table → new row should have `user_id` set

**Step 4: Commit any smoke test fixes**

---

## Task Dependency Graph

```
Task 1 (migration) ──► Task 2 (FB creds backfill)
       │
       ├──► Task 3 (capi.ts) ──► Task 4 (/go route)
       │                              │
       │                              ├──► Task 5 (webhook)
       │                              │
       ├──► Task 6 (bots API)         │
       │                              │
       ├──► Task 7 (auth callback)    │
       │                              │
       ├──► Task 8 (middleware)       │
       │                              │
       ├──► Task 9 (dashboard layout) │
       │                              │
       ├──► Task 11 (onboarding)      │
       │                              │
       └──► Task 12 (settings) ───────┘
                                      │
                              Task 13 (login)
                                      │
                              Task 14 (verify)
```

Tasks 3, 6, 7, 8, 9, 11, 12, 13 can run in parallel after Task 1+2. Tasks 4 and 5 depend on Task 3 (capi.ts changes). Task 14 is last.
