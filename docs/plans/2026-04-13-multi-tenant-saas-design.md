# burnlink Multi-Tenant SaaS — Design Document

**Date:** 2026-04-13
**Status:** Approved

## Goal

Transform burnlink from a single-operator tool into a multi-tenant SaaS platform where anyone can sign up, connect their own FB Pixel + Telegram bots, and track ad-to-channel conversions independently.

## Locked Decisions

| Decision | Choice |
|---|---|
| Tenancy | Multi-operator SaaS |
| Monetization | Free for now, billing added later |
| Auth | Magic link open to anyone (Supabase OTP) |
| Isolation | Shared tables + `user_id` FK + RLS |
| FB credentials | Per-user in DB (`user_settings` table) |
| Click routing | Query param: `/go?uid=<slug>&fbclid=...` |
| Landing page | Marketing/conversion page at `/` |
| Admin panel | `/admin` for superadmin (is_admin flag) |
| Priority | Phase 1 (multi-tenant core) → Phase 2 (onboarding + landing) → Phase 3 (frontend polish) |

## Phase 1: Multi-Tenant Core

### Data Model Changes

**New table: `user_settings`**
```sql
create table user_settings (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  slug          text unique not null,
  fb_pixel_id   text,
  fb_capi_token text,
  fb_test_code  text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index on user_settings (slug);
```

**Add `user_id` column to:**
- `bots` — `user_id uuid not null references auth.users(id)`
- `clicks` — `user_id uuid not null references auth.users(id)`
- `joins` — `user_id uuid not null references auth.users(id)`
- `capi_events` — `user_id uuid not null references auth.users(id)`
- `ops_log` — `user_id uuid references auth.users(id)` (nullable, system events have no user)

`invite_links` does NOT need `user_id` — ownership is inherited via `bot_id → bots.user_id`.

**Backfill:** Migration creates a `user_settings` row for the current operator email (wordlw82@gmail.com) with `is_admin: true`. All existing bots/clicks/joins/capi_events get `user_id` set to that user's auth.users id.

**RLS rewrite:**
- Remove `app_config` table and `is_operator()` function
- All tables: `SELECT/INSERT/UPDATE` where `auth.uid() = user_id`
- `invite_links`: policy joins through `bots` to check `user_id`
- `user_settings`: users can only read/update their own row; admins can read all

**`pop_unused_link` function:**
- Add `p_user_id uuid` parameter
- Only pops from bots where `bots.user_id = p_user_id`
- Prevents cross-tenant link leakage

**`pool_health_vw`:**
- Add `user_id` from `bots` table into the view
- RLS on the view scopes it per-user automatically

### `/go` Route Changes

New flow: `/go?uid=<slug>&fbclid=...`

1. Parse `uid` from query params
2. Look up `user_settings` by `slug` → get `user_id`, `fb_pixel_id`, `fb_capi_token`
3. If slug missing/invalid → 400 error
4. Pop link from that user's pool: `pop_unused_link(click_id, user_id)`
5. Insert `clicks` row with `user_id`
6. Fire CAPI PageView with that user's pixel/token (skip if unconfigured, log warning)
7. 302 redirect to invite link (or `/sold-out` if that user's pool is empty)

`fireCapi()` changes from reading env vars to accepting `pixel_id` + `capi_token` as parameters.

### Webhook Handler Changes

**`chat_member` (user joins):**
- After looking up invite_link → bot, follow `bot.user_id` → `user_settings` to get FB credentials
- Fire CAPI Lead with that user's pixel/token
- Insert `joins` and `capi_events` with `user_id`

**`my_chat_member` (auto-discovery):**
- No changes needed — bot already has `user_id`, new channel pair inherits it

### Bot-Add + Dashboard Scoping

**`POST /api/bots`:**
- Get `user_id` from Supabase session (`auth.uid()`)
- Insert bot with `user_id` set
- Remove `OPERATOR_EMAIL` check — any authenticated user can add bots

**Dashboard:**
- Remove all `OPERATOR_EMAIL` checks
- RLS handles data isolation — queries naturally return only the user's data
- All existing dashboard pages work without code changes (beyond removing operator checks)

**New: `/dashboard/settings` page:**
- Form for `fb_pixel_id`, `fb_capi_token`, `fb_test_code`
- Shows user's slug and tracking URL (`/go?uid=<slug>`)
- "Copy tracking URL" button

### Refill Cron

- `refillAllActive()` iterates all active bots across all users — no scoping needed
- Each bot's `channel_id` and `token` are self-contained
- No user credentials needed for Telegram API calls (only for CAPI)

## Phase 2: Onboarding + Landing Page

### Auth + Onboarding Flow

**Sign-up (new users):**
1. Landing page → "Get started" → `/signup`
2. Enter email → magic link
3. `/auth/callback` → detect new user (no `user_settings` row)
4. Redirect to `/onboarding`:
   - Step 1: Display name + slug (auto-generated, editable)
   - Step 2: FB Pixel ID + CAPI token (skippable)
5. Save `user_settings` → redirect to `/dashboard`

**Returning users:**
- `/login` → magic link → `/auth/callback` → has `user_settings` → `/dashboard`

**Middleware rules:**
- `/dashboard/*` → authenticated + has `user_settings`, else → `/onboarding` or `/login`
- `/admin/*` → authenticated + `is_admin = true`, else → 404
- `/onboarding` → authenticated + no `user_settings`, else → `/dashboard`

### Landing Page (`/`)

Public marketing page. Sections:
1. **Hero** — headline + "Get started free" CTA
2. **How it works** — 3-step visual (FB ad → burnlink → Telegram → CAPI)
3. **Features** — 3-4 cards (attribution, pool management, auto-discovery, dashboard)
4. **CTA repeat** — sign-up button
5. **Footer** — minimal

Design: dark theme (#0a0a0b), orange accent (#ff5a1f), clean/modern, responsive.

### Admin Panel (`/admin`)

Pages:
1. **Users list** — email, display name, slug, created_at, bot count, clicks, joins, pixel configured
2. **Global stats** — total users, clicks, joins, active bots, pool health
3. **User drill-down** — read-only view of a user's bots, pool, events
4. **Global ops log** — unfiltered ops_log across all users

Auth: `is_admin` flag on `user_settings`. Non-admins get 404.

Not in scope: user edit/delete, impersonation, billing management.

## Phase 3: Frontend Polish

Not designed yet. Will cover:
- Dashboard redesign (better data viz, charts, responsive)
- Loading states, empty states, error boundaries
- Consistent component library
- Mobile-friendly layout

## Migration Strategy

Phase 1 migration must:
1. Create `user_settings` table
2. Add `user_id` columns (nullable first for backfill)
3. Backfill existing data to operator's user_id
4. Make `user_id` NOT NULL after backfill
5. Rewrite RLS policies
6. Update `pop_unused_link` function signature
7. Drop `app_config` table (replaced by `user_settings`)
8. Update `pool_health_vw`

This is a breaking migration — existing sessions will need to re-authenticate.

## Out of Scope

- Billing / Stripe / plans
- Rate limiting per user
- User deletion / account management
- Email notifications
- API keys for programmatic access
- Custom domains per user
- TikTok / Google / Instagram CAPI
