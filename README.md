# burnlink

FB Ads → private Telegram channel tracker with server-side CAPI attribution.

**Single-operator.** One person signs in via magic link and runs the whole thing.

## How it works

```
FB ad → /go?fbclid=...   (server captures click, pops unused burn-link, fires CAPI PageView)
      → 302 to t.me/+<hash>
      → user joins private channel
      → Telegram chat_member webhook  (server matches link→click, fires CAPI Lead)
```

- Each Telegram admin bot maintains a pool of **1000 single-use invite links** (`member_limit=1`).
- A Vercel Cron tops up any bot pool that drops below 200 unused links.
- The landing redirect is invisible — users never see a page, just a 302.
- Attribution stops at "joined channel." Affiliate clicks in the pinned post are not tracked per-user.

## Stack

- Next.js 15 (App Router) on Vercel
- Supabase Postgres + Auth (magic link, single allowlisted email)
- Tailwind CSS
- Facebook Conversions API (Graph v20.0)
- Telegram Bot API

## Setup

### 1. Supabase

Create a fresh Supabase project. In the SQL editor, run the migrations in order:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_rls.sql
supabase/migrations/0003_pop_unused_link_fn.sql
```

Then seed the operator email:

```sql
insert into app_config (id, operator_email) values (1, 'you@example.com')
  on conflict (id) do update set operator_email = excluded.operator_email;
```

### 2. Env vars

Copy `.env.local.example` to `.env.local` and fill everything in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPERATOR_EMAIL` — must match the email you inserted into `app_config`
- `FB_PIXEL_ID`, `FB_CAPI_ACCESS_TOKEN` — from Facebook Events Manager
- `FB_TEST_EVENT_CODE` — optional, only while validating end-to-end
- `TG_WEBHOOK_SECRET` — `openssl rand -hex 32`
- `CRON_SECRET` — `openssl rand -hex 32`
- `APP_URL` — the public URL your site will be served from

### 3. Install + run

```bash
npm install
npm run dev
```

### 4. Log in

Go to `http://localhost:3000/login`, request a magic link, open it. You should land on `/dashboard`.

### 5. Add bots

Go to `/dashboard/bots` and paste each bot's BotFather token. burnlink will:

1. Validate the token via `getMe`.
2. Register the Telegram webhook automatically.
3. Show the bot as "waiting for channel…"

Then in Telegram, add the bot to your private channel as an **admin** with the "Invite users" permission. burnlink will auto-detect the channel and seed an initial batch of 200 links. The cron refill tops it up to 1000.

One bot can serve multiple channels — just add it as admin to each one.

### 6. Point FB ads at `/go`

Use `https://your-app.vercel.app/go` as the ad destination. FB will append `fbclid` automatically. Add UTM params for campaign / source / content so the funnel view can break them down.

## Verification

1. **Click bridge** — visit `/go?fbclid=test123&utm_campaign=spring&utm_source=fb` in a private window. Expect a row in `clicks`, a row in `invite_links` flipped to `reserved`, a 302 to `t.me/+...`, and a `capi_events` row for PageView.
2. **Join** — tap the `t.me` link in Telegram, join the channel. Expect a row in `joins`, the `invite_links` row flipped to `burned`, a `capi_events` row for Lead, and both events visible in Facebook Events Manager.
3. **Pool refill** — mark ~900 links as `burned` in SQL; within 60s the cron should backfill.
4. **Sold-out fallback** — mark all links `burned`; `/go` should 302 to `/sold-out` and log an `ops_log` error.

## Runtime notes

- `/go` runs on the Node runtime and uses `next/server`'s `after()` for fire-and-forget CAPI so the 302 goes out before Facebook's Graph API responds.
- The Telegram webhook is path-secret protected because Telegram can't send custom headers. The `X-Telegram-Bot-Api-Secret-Token` header is also validated if present.
- `pop_unused_link()` uses `SELECT … FOR UPDATE SKIP LOCKED`, which is why concurrent `/go` hits never hand out the same link.

## Out of scope (by design)

- Per-user affiliate attribution (no `/out` redirect, no `Purchase` event)
- Multi-tenant / orgs / billing
- Bot-first DM flow
- TikTok, Google, Instagram CAPI (Facebook only)
