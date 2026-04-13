# burnlink Enhancements Round 2 — Design Document

**Date:** 2026-04-13
**Status:** Approved
**Prerequisite:** Multi-tenant SaaS (all phases complete)

## Goal

Expand burnlink from a Facebook-only click→join tracker into a multi-platform attribution system with full-funnel tracking (click → join → affiliate click-out) and operator-facing bot automation.

## Locked Decisions

| Decision | Choice |
|---|---|
| Architecture | Platform-aware adapter pattern (common event → per-platform adapters) |
| CAPI platforms | Facebook (existing) + TikTok Events API + Google Ads Conversions |
| Third event | InitiateCheckout fired on `/out` redirect (affiliate link click-out) |
| `/out` mechanism | Server-side 302 redirect (same pattern as `/go`) |
| Attribution | Best-effort: `/out` links embed `jid` → join → click → original click IDs |
| Welcome DM | Bot sends `/out` URL to new members — primary affiliate conversion path |
| Alert delivery | Telegram DM to operator (urgent) + dashboard ops_log (history) |
| Build order | Phase 4 (bot automation) → Phase 5 (multi-CAPI) → Phase 6 (general improvements) |

## Phase 4: Bot Automation (ships first)

### 4.1 `/out` Redirect Route

**New route: `app/out/route.ts`** (GET handler)

Flow:
1. Parse `uid` (slug) and `jid` (join ID) from query params
2. Look up `user_settings` by slug → user_id + all platform credentials
3. Best-effort attribution: if `jid` provided, look up `joins` → `clicks` to get original `fbclid`, `fbc`, `fbp`, `ttclid`, `gclid`, IP, UA, country
4. Fire InitiateCheckout event on all configured platforms via `fireEvents()`
5. 302 redirect to `user_settings.affiliate_url`
6. If `affiliate_url` is null → 404

**New table: `out_clicks`**
```sql
create table out_clicks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  join_id       uuid references joins(id),
  click_id      uuid references clicks(id),
  event_id      text not null,
  affiliate_url text not null,
  created_at    timestamptz default now()
);
```

**Schema change:**
```sql
alter table user_settings add column affiliate_url text;
```

Dashboard: Add affiliate URL field to `/dashboard/settings`.

### 4.2 Welcome DM System

**New table: `welcome_messages`**
```sql
create table welcome_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  bot_id      uuid not null references bots(id),
  channel_id  bigint not null,
  message     text not null,
  is_active   boolean default true,
  created_at  timestamptz default now(),
  unique(bot_id, channel_id)
);
```

Default template: `"Welcome! 👉 {out_link}"`

The `{out_link}` placeholder is replaced at send time with `APP_URL/out?uid=<slug>&jid=<join_id>`.

**Webhook handler change:** After inserting the `joins` row and firing CAPI Lead, send a DM to `cm.new_chat_member.user.id` using the bot's token. Look up `welcome_messages` by bot_id + channel_id. If no row or `is_active = false`, skip.

**Failure handling:** If `sendMessage` fails (privacy settings), log to `ops_log` with level `warn`. Don't retry.

**Dashboard:** New section on `/dashboard/bots` or dedicated `/dashboard/messages` page for configuring welcome messages per bot-channel pair.

### 4.3 `/start` Command Handler

Adds operator DM capability to bots.

**Webhook update:** Add `"message"` to the `allowed_updates` list in `setWebhook` (currently `["chat_member", "my_chat_member"]`).

**Handler:** When bot receives `/start alerts_<user_id>`:
1. Verify the `user_id` matches a real `user_settings` row
2. Save the Telegram chat ID to `user_settings.telegram_chat_id`
3. Reply: "Alerts enabled! You'll receive pool and CAPI notifications here."

**Schema change:**
```sql
alter table user_settings add column telegram_chat_id bigint;
```

**Dashboard:** After adding a bot, show "Enable Telegram alerts" button → opens `t.me/<bot_username>?start=alerts_<user_id>`. One-time setup.

### 4.4 Operator Alerts

**New file: `lib/alerts.ts`**

```typescript
async function sendOperatorAlert(userId: string, message: string): Promise<void>
```

1. Look up `user_settings.telegram_chat_id` for the user
2. Pick the user's first active bot token
3. Call `sendMessage(chat_id, message)`
4. Also insert into `ops_log` for dashboard history

**Trigger conditions:**
- Pool drops below 100 unused links for any bot-channel pair (checked during cron refill)
- CAPI call fails (any platform, HTTP != 200) — triggered in `fireEvents()`
- Bot removed from channel (already detected in `my_chat_member` handler)

### 4.5 `/stats` Bot Command

Operator DMs bot with `/stats`. Bot replies with:
- Clicks (24h / 7d)
- Joins (24h / 7d)
- Join rate
- Pool health per channel
- CAPI success rate (24h)

Queries same data as dashboard overview. Requires `/start` flow to have been completed (to identify which operator is asking).

### 4.6 Dashboard Alert History

New page: `/dashboard/alerts`

- Reads from `ops_log` filtered by `user_id` and recent error/warn entries
- Table: timestamp, level, source, message
- Add "Alerts" tab to dashboard navigation

## Phase 5: Multi-Platform CAPI

### 5.1 Platform Adapter Architecture

**New file: `lib/events.ts`** — unified event dispatcher

```typescript
type EventKind = "PageView" | "Lead" | "InitiateCheckout";

interface TrackingEvent {
  kind: EventKind;
  event_id: string;
  event_source_url: string;
  action_source: "website" | "chat";
  user_data: {
    fbclid?: string; fbc?: string; fbp?: string;
    ttclid?: string;
    gclid?: string;
    client_ip_address?: string;
    client_user_agent?: string;
    country?: string;
  };
}

interface PlatformCredentials {
  facebook?: { pixel_id: string; access_token: string; test_event_code?: string };
  tiktok?: { pixel_id: string; access_token: string; test_event_code?: string };
  google?: { customer_id: string; conversion_action_id: string; developer_token: string; refresh_token: string };
}

async function fireEvents(event: TrackingEvent, creds: PlatformCredentials): Promise<PlatformResults>
```

Runs `Promise.allSettled()` across all configured adapters. Platforms with no credentials silently skipped. Each result logged to `capi_events` with platform column.

**Adapter files:**
- `lib/platforms/facebook.ts` — extracted from existing `lib/capi.ts`
- `lib/platforms/tiktok.ts` — new
- `lib/platforms/google.ts` — new

### 5.2 Credential Storage

**Schema changes:**
```sql
alter table user_settings add column tt_pixel_id text;
alter table user_settings add column tt_access_token text;
alter table user_settings add column tt_test_code text;
alter table user_settings add column gads_customer_id text;
alter table user_settings add column gads_conversion_action_id text;
alter table user_settings add column gads_developer_token text;
alter table user_settings add column gads_refresh_token text;
```

**Dashboard:** Three collapsible sections on `/dashboard/settings` — Facebook, TikTok, Google — each with their credential fields.

### 5.3 Click ID Capture

**`extractClickContext()` changes:**
- Capture `ttclid` from `?ttclid=` query param
- Capture `gclid` from `?gclid=` query param

**Schema:**
```sql
alter table clicks add column ttclid text;
alter table clicks add column gclid text;
```

One `/go?uid=<slug>` URL works for all ad platforms — each appends its own click ID.

### 5.4 Facebook Adapter

Extracted from `lib/capi.ts`. Same logic, same Graph API v20.0 endpoint. No behavioral change.

Event mapping: PageView → PageView, Lead → Lead, InitiateCheckout → InitiateCheckout.

### 5.5 TikTok Adapter

Endpoint: `business-api.tiktok.com/open_api/v1.3/event/track/`

Auth: `Access-Token` header.

Event mapping:
- PageView → `ViewContent`
- Lead → `SubmitForm`
- InitiateCheckout → `InitiateCheckout`

User data: `ttclid`, SHA-256 hashed IP + UA (TikTok requires client-side hashing unlike FB).

### 5.6 Google Adapter

Endpoint: Google Ads API enhanced conversions.

Event mapping:
- PageView → typically not sent (Google uses click-through attribution)
- Lead → conversion action
- InitiateCheckout → conversion action

User data: `gclid`, hashed email if available.

Auth: OAuth2 refresh token flow — more complex than FB/TikTok.

### 5.7 CAPI Events Table

```sql
alter table capi_events add column platform text not null default 'facebook';
```

Platform values: `'facebook'`, `'tiktok'`, `'google'`.

Each `fireEvents()` call produces up to 3 rows (one per platform). Shared `event_id` for correlation.

### 5.8 Wire All Fire Points

Replace `fireCapi()` calls with `fireEvents()` in:
1. `/go` route (PageView)
2. Telegram webhook handler (Lead)
3. `/out` route (InitiateCheckout)

Each call site reads all platform credentials from `user_settings` and passes them as `PlatformCredentials`.

## Phase 6: General Improvements

### 6.1 Custom SMTP (ops task)

Configure custom SMTP in Supabase Auth settings. Recommended: Resend (free 100/day).
1. Sign up for Resend, verify sending domain
2. Supabase Dashboard → Auth → SMTP Settings → Enable Custom SMTP
3. Enter credentials

No code changes.

### 6.2 Minute-Level Cron (ops task)

Use external cron service (cron-job.org or Upstash QStash) to hit `POST /api/cron` with `CRON_SECRET` every 5 minutes.

No code changes.

### 6.3 Per-Campaign Breakdown

New page: `/dashboard/campaigns`

Groups clicks/joins by `utm_campaign`, `utm_source`, `utm_content`.

Table columns: campaign | source | clicks | joins | join rate | CAPI success.

Date range filter: 7d / 30d / custom.

### 6.4 Funnel Upgrade

Upgrade existing `/dashboard/funnel` to three stages:
1. Clicks (from `/go`)
2. Joins (from webhook)
3. Out Clicks (from `/out`)

Per-platform breakdown within each stage (FB / TikTok / Google).

Visual funnel chart using recharts (already a dependency).

Depends on Phase 4.1 (`out_clicks`) and Phase 5.7 (`capi_events.platform`).

### 6.5 CSV Export

Add "Export CSV" button to campaigns, funnel, and events pages.

Client-side generation from loaded data. Columns match displayed table.

### 6.6 Account Management

**Change slug:**
- Make slug field editable in `/dashboard/settings`
- Validation: lowercase alphanumeric + hyphens, 3-30 chars, unique
- Warning: "Changing your slug will break existing tracking URLs"

**Delete account:**
- "Danger zone" section at bottom of settings
- Confirmation: type slug to confirm
- Backend `DELETE /api/account`:
  1. Deactivate all bots (call `deleteWebhook` for each)
  2. Delete `user_settings` row (FK cascade cleans up app data)
  3. Call `supabase.auth.admin.deleteUser(userId)` to remove auth identity
- Hard delete — no soft delete, no billing, no retention requirement

## Migration Plan

- **`0008_bot_automation.sql`** — `welcome_messages`, `out_clicks`, `affiliate_url` + `telegram_chat_id` on `user_settings`, RLS policies
- **`0009_multi_capi.sql`** — `ttclid`/`gclid` on `clicks`, TikTok/Google credential columns on `user_settings`, `platform` on `capi_events`
- **`0010_account_mgmt.sql`** — cascade setup for hard delete if needed

## Out of Scope

- Billing / Stripe / plans
- Rate limiting per user
- Email notifications
- API keys for programmatic access
- Custom domains per user
- Postback/webhook from affiliate networks
- Bot inline buttons for affiliate links
- Auto-kick/prune members
- Scheduled/automated channel posts
