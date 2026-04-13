# Phase 4: Bot Automation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/out` affiliate redirect with full-chain attribution, welcome DMs to new channel members, operator Telegram alerts, `/stats` bot command, and a dashboard alerts page.

**Architecture:** Extend the existing webhook handler and `/go`-style redirect pattern. The `/out` route mirrors `/go` (fire-and-forget CAPI → 302). Welcome DMs are sent inline during join processing. Operator alerts are delivered via Telegram DM (requires one-time `/start` handshake) and logged to `ops_log` for dashboard history.

**Tech Stack:** Next.js 15 App Router, Supabase Postgres + RLS, Telegram Bot API (`sendMessage`), existing `fireCapi()` (replaced by `fireEvents()` in Phase 5)

**Design doc:** `docs/plans/2026-04-13-enhancements-round2-design.md`

---

## Task 1: Migration — new tables and columns

**Files:**
- Create: `supabase/migrations/0008_bot_automation.sql`

**Step 1: Write the migration**

```sql
-- burnlink 0008: bot automation
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
  message     text not null default 'Welcome! 👉 {out_link}',
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
```

**Step 2: Run migration against Supabase**

Run the SQL in Supabase SQL Editor or via CLI:
```bash
npx supabase db push
```

Expected: all statements succeed, no errors.

**Step 3: Commit**

```bash
git add supabase/migrations/0008_bot_automation.sql
git commit -m "feat: migration 0008 — out_clicks, welcome_messages, affiliate_url, telegram_chat_id"
```

---

## Task 2: `/out` redirect route

**Files:**
- Create: `app/out/route.ts`

**Step 1: Create the `/out` route**

This mirrors `app/go/route.ts` — resolve user by slug, best-effort attribution via join ID, fire CAPI, 302 redirect.

```typescript
// Affiliate click-out redirect.
//
// /out?uid=<slug>&jid=<join_id> →
//   1) resolve uid slug → user_settings (user_id + credentials + affiliate_url)
//   2) best-effort: jid → joins → clicks → original fbclid/fbc/fbp/ip/ua/country
//   3) insert out_clicks row
//   4) fire-and-forget CAPI InitiateCheckout (after response)
//   5) 302 to affiliate_url

import { NextRequest, NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { fireCapi } from "@/lib/capi";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid");
  const jid = url.searchParams.get("jid");

  if (!uid) {
    return NextResponse.json({ error: "missing uid parameter" }, { status: 400 });
  }

  const sb = serviceClient();

  // 1. Resolve user
  const { data: user } = await sb
    .from("user_settings")
    .select("id, fb_pixel_id, fb_capi_token, fb_test_code, affiliate_url")
    .eq("slug", uid)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "invalid uid" }, { status: 404 });
  }

  if (!user.affiliate_url) {
    return NextResponse.json({ error: "no affiliate URL configured" }, { status: 404 });
  }

  // 2. Best-effort attribution via join → click
  let click: {
    id: string;
    fbclid: string | null;
    fbc: string | null;
    fbp: string | null;
    ip: string | null;
    user_agent: string | null;
    country: string | null;
  } | null = null;
  let joinId: string | null = jid;

  if (jid) {
    const { data: joinRow } = await sb
      .from("joins")
      .select("id, click_id")
      .eq("id", jid)
      .eq("user_id", user.id)
      .maybeSingle();

    if (joinRow?.click_id) {
      joinId = joinRow.id;
      const { data: clickRow } = await sb
        .from("clicks")
        .select("id, fbclid, fbc, fbp, ip, user_agent, country")
        .eq("id", joinRow.click_id)
        .maybeSingle();
      click = clickRow ?? null;
    }
  }

  // Request context for logging
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const reqIp = (xff.split(",")[0] || "").trim() || null;
  const reqUa = req.headers.get("user-agent");
  const reqCountry = req.headers.get("x-vercel-ip-country") ?? null;

  // 3. Insert out_clicks row
  const { data: outClick, error: outErr } = await sb
    .from("out_clicks")
    .insert({
      user_id: user.id,
      join_id: joinId,
      click_id: click?.id ?? null,
      affiliate_url: user.affiliate_url,
      ip: reqIp,
      user_agent: reqUa,
      country: reqCountry,
    })
    .select("id, event_id")
    .single();

  if (outErr) {
    await logOps("error", "out", "out_clicks insert failed", {
      error: outErr.message,
      user_id: user.id,
    });
  }

  // 4. Fire-and-forget CAPI InitiateCheckout
  after(async () => {
    const creds = user.fb_pixel_id && user.fb_capi_token
      ? { pixel_id: user.fb_pixel_id, access_token: user.fb_capi_token, test_event_code: user.fb_test_code }
      : undefined;

    if (!creds) {
      await logOps("warn", "capi", "InitiateCheckout skipped — no FB credentials", { user_id: user.id });
      return;
    }

    const eventId = outClick?.event_id ?? crypto.randomUUID();
    try {
      const result = await fireCapi({
        kind: "InitiateCheckout" as any,
        event_id: eventId,
        event_source_url: url.toString(),
        action_source: "website",
        user_data: {
          fbclid: click?.fbclid ?? null,
          fbc: click?.fbc ?? null,
          fbp: click?.fbp ?? null,
          client_ip_address: click?.ip ?? reqIp,
          client_user_agent: click?.user_agent ?? reqUa,
          country: click?.country ?? reqCountry,
        },
      }, creds);
      await sb.from("capi_events").insert({
        kind: "InitiateCheckout",
        click_id: click?.id ?? null,
        join_id: joinId,
        user_id: user.id,
        event_id: eventId,
        request_body: result.request as object,
        response: result.body as object,
        http_status: result.status,
      });
    } catch (e) {
      await logOps("error", "capi", "InitiateCheckout fire failed", {
        user_id: user.id,
        error: (e as Error).message,
      });
    }
  });

  // 5. 302 redirect
  return NextResponse.redirect(user.affiliate_url, 302);
}
```

**Step 2: Update CAPI type to include InitiateCheckout**

In `lib/capi.ts:14`, change:
```typescript
export type CapiEventKind = "PageView" | "Lead" | "InitiateCheckout";
```

Remove the `as any` cast in the `/out` route after this.

**Step 3: Add "out" to ops_log source type**

In `lib/ops.ts:4`, add `"out"` to the source union:
```typescript
  source: "go" | "webhook" | "refill" | "capi" | "bots" | "auth" | "out" | "alerts",
```

**Step 4: Verify — smoke test `/out`**

```
curl -v "http://localhost:3000/out?uid=default"
```

Expected: 404 (no affiliate_url configured yet). After setting one in DB:
```sql
update user_settings set affiliate_url = 'https://example.com' where slug = 'default';
```

```
curl -v "http://localhost:3000/out?uid=default&jid=<any-join-uuid>"
```

Expected: 302 to `https://example.com`.

**Step 5: Commit**

```bash
git add app/out/route.ts lib/capi.ts lib/ops.ts
git commit -m "feat: /out affiliate redirect route with InitiateCheckout CAPI + best-effort attribution"
```

---

## Task 3: Add affiliate URL to settings page

**Files:**
- Modify: `app/dashboard/settings/SettingsClient.tsx`
- Modify: `app/api/settings/route.ts`
- Modify: `app/dashboard/settings/page.tsx` (if it passes initial data)

**Step 1: Update settings API to accept affiliate_url**

In `app/api/settings/route.ts`, add `affiliate_url` to the body type and update statement:

```typescript
const body = (await req.json().catch(() => null)) as {
  fb_pixel_id?: string | null;
  fb_capi_token?: string | null;
  fb_test_code?: string | null;
  affiliate_url?: string | null;
} | null;
```

And in the `.update()` call, add:
```typescript
affiliate_url: body.affiliate_url,
```

**Step 2: Update settings page server component**

In `app/dashboard/settings/page.tsx`, add `affiliate_url` to the select query so it gets passed to the client component.

**Step 3: Update SettingsClient to show affiliate URL field**

Add a new section between "Tracking URL" and "Facebook CAPI Credentials":

```tsx
<section>
  <h2 className="text-lg font-semibold mb-3">Affiliate URL</h2>
  <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
    <p className="text-xs text-muted mb-2">
      The destination URL for /out redirects. This is where users go when they click
      the affiliate link in the welcome DM.
    </p>
    <input
      value={affiliateUrl}
      onChange={(e) => setAffiliateUrl(e.target.value)}
      placeholder="https://your-affiliate-offer.com/..."
      className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
    />
  </div>
</section>
```

Add `affiliateUrl` state, include it in the save payload, and add it to the `Settings` interface.

Also update the Tracking URL section to show the `/out` URL below the `/go` URL:
```tsx
<p className="text-xs text-muted mt-2">Affiliate redirect URL:</p>
<code className="bg-bg border border-border rounded px-3 py-2 text-sm font-mono break-all">
  {outUrl}
</code>
```

Where `outUrl` is `${origin}/out?uid=${slug}` (the `&jid=` is appended by the welcome DM at runtime).

**Step 4: Include affiliate_url in the save function body**

```typescript
body: JSON.stringify({
  fb_pixel_id: pixelId || null,
  fb_capi_token: capiToken || null,
  fb_test_code: testCode || null,
  affiliate_url: affiliateUrl || null,
}),
```

**Step 5: Verify — open settings, set an affiliate URL, save, reload**

Expected: value persists. Then test `/out?uid=<slug>` redirects to it.

**Step 6: Commit**

```bash
git add app/dashboard/settings/SettingsClient.tsx app/api/settings/route.ts app/dashboard/settings/page.tsx
git commit -m "feat: affiliate URL field in settings — configures /out redirect destination"
```

---

## Task 4: Telegram `sendMessage` helper

**Files:**
- Modify: `lib/telegram.ts`

**Step 1: Add sendMessage to the tg object**

After `deleteWebhook` in `lib/telegram.ts:85-87`, add:

```typescript
async sendMessage(token: string, chat_id: number, text: string, parse_mode?: "HTML" | "Markdown") {
  return call<{ message_id: number }>(token, "sendMessage", {
    chat_id,
    text,
    ...(parse_mode ? { parse_mode } : {}),
  });
},
```

**Step 2: Update setWebhook allowed_updates**

In `lib/telegram.ts:78`, change:
```typescript
allowed_updates: ["chat_member", "my_chat_member", "message"],
```

This enables the bot to receive `/start` and `/stats` commands.

**Step 3: Commit**

```bash
git add lib/telegram.ts
git commit -m "feat: add sendMessage to Telegram helper + allow message updates in webhook"
```

---

## Task 5: Welcome DM on channel join

**Files:**
- Modify: `app/api/telegram/webhook/[secret]/route.ts` (the `chat_member` join handler, lines 276-341)

**Step 1: Add welcome DM logic after join processing**

After the CAPI Lead fire block (after line 339), before the final `return NextResponse.json({ ok: true })`, add:

```typescript
// Send welcome DM with /out link
try {
  const { data: wm } = await sb
    .from("welcome_messages")
    .select("message, bot_id")
    .eq("bot_id", link.bot_id)
    .eq("channel_id", cm.chat.id)
    .eq("is_active", true)
    .maybeSingle();

  if (wm) {
    // Look up user settings for slug and affiliate_url
    const { data: ownerSettings } = botRow?.user_id
      ? await sb
          .from("user_settings")
          .select("slug, affiliate_url")
          .eq("id", botRow.user_id)
          .maybeSingle()
      : { data: null };

    if (ownerSettings?.affiliate_url) {
      const outLink = `${process.env.APP_URL}/out?uid=${ownerSettings.slug}&jid=${joinRow.id}`;
      const text = wm.message.replace("{out_link}", outLink);

      // Get bot token for sending
      const { data: botForSend } = await sb
        .from("bots")
        .select("token")
        .eq("id", link.bot_id)
        .single();

      if (botForSend) {
        const { tg } = await import("@/lib/telegram");
        await tg.sendMessage(botForSend.token, cm.new_chat_member.user.id, text);
      }
    }
  }
} catch (e) {
  // Welcome DM failure must not break the join flow
  await logOps("warn", "webhook", "welcome DM failed", {
    join_id: joinRow.id,
    telegram_user_id: cm.new_chat_member.user.id,
    error: (e as Error).message,
  });
}
```

Note: The `tg` import is already at the top level via `@/lib/telegram`. Adjust the import if `tg` is already imported at the top of the file. In the current file it's not imported — `lib/telegram` is only used in `lib/pool.ts` and `app/api/bots/route.ts`. Add the import at the top:

```typescript
import { tg } from "@/lib/telegram";
```

**Step 2: Verify**

- Set up a welcome_messages row in the DB for an existing bot-channel pair
- Have a test user join the channel
- Expected: user receives a DM with the `/out` link

**Step 3: Commit**

```bash
git add app/api/telegram/webhook/[secret]/route.ts
git commit -m "feat: welcome DM with /out affiliate link on channel join"
```

---

## Task 6: `/start` command handler for operator alerts

**Files:**
- Modify: `app/api/telegram/webhook/[secret]/route.ts`

**Step 1: Add message handler interface**

Add to the interfaces section (after line 41):

```typescript
interface TgMessageUpdate {
  message_id: number;
  from: { id: number; is_bot: boolean; username?: string; first_name?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
}
```

Update the `TgChatMemberUpdate` interface to include `message`:

```typescript
interface TgChatMemberUpdate {
  update_id: number;
  chat_member?: { /* existing */ };
  my_chat_member?: TgMyChatMemberUpdate;
  message?: TgMessageUpdate;
}
```

**Step 2: Add message handler function**

Before the `POST` handler, add:

```typescript
async function handleMessage(msg: TgMessageUpdate): Promise<void> {
  const text = msg.text?.trim() ?? "";
  const chatId = msg.chat.id;

  // Only handle private messages (DMs to the bot)
  if (msg.chat.type !== "private") return;

  const sb = serviceClient();

  // /start alerts_<user_id> — link operator's Telegram chat for alerts
  const startMatch = text.match(/^\/start\s+alerts_(.+)$/);
  if (startMatch) {
    const userId = startMatch[1];

    const { data: settings } = await sb
      .from("user_settings")
      .select("id, display_name")
      .eq("id", userId)
      .maybeSingle();

    if (!settings) {
      // Find a bot token to respond — look up by the bot that received this message
      // We don't have botTgId here directly, but we can find it from any active bot
      await logOps("warn", "webhook", "/start with invalid user_id", { userId, chatId });
      return;
    }

    const { error } = await sb
      .from("user_settings")
      .update({ telegram_chat_id: chatId })
      .eq("id", userId);

    if (error) {
      await logOps("error", "webhook", "failed to save telegram_chat_id", {
        userId,
        chatId,
        error: error.message,
      });
      return;
    }

    // Find a bot token to send the confirmation reply
    const { data: bot } = await sb
      .from("bots")
      .select("token")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (bot) {
      await tg.sendMessage(
        bot.token,
        chatId,
        "✅ Alerts enabled! You'll receive pool and CAPI notifications here.",
      );
    }

    await logOps("info", "webhook", "operator linked Telegram for alerts", {
      userId,
      chatId,
    });
    return;
  }

  // /stats — send operator stats summary
  if (text === "/stats") {
    await handleStats(msg, sb);
    return;
  }
}
```

**Step 3: Wire message handler into POST**

In the `POST` function, after the `my_chat_member` block (after line 212), add:

```typescript
if (update.message) {
  try {
    await handleMessage(update.message);
  } catch (e) {
    await logOps("error", "webhook", "message handler failed", {
      error: (e as Error).message,
    });
  }
  return NextResponse.json({ ok: true });
}
```

**Step 4: Commit**

```bash
git add app/api/telegram/webhook/[secret]/route.ts
git commit -m "feat: /start command handler — links operator Telegram chat for alerts"
```

---

## Task 7: `/stats` bot command

**Files:**
- Modify: `app/api/telegram/webhook/[secret]/route.ts`

**Step 1: Add handleStats function**

Add before `handleMessage`:

```typescript
async function handleStats(
  msg: TgMessageUpdate,
  sb: ReturnType<typeof serviceClient>,
): Promise<void> {
  const chatId = msg.chat.id;

  // Find which user this chat belongs to
  const { data: settings } = await sb
    .from("user_settings")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (!settings) {
    // Can't identify operator — they haven't done /start yet
    return;
  }

  const userId = settings.id;
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Clicks 24h / 7d
  const { count: clicks24h } = await sb
    .from("clicks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", h24);

  const { count: clicks7d } = await sb
    .from("clicks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", d7);

  // Joins 24h / 7d
  const { count: joins24h } = await sb
    .from("joins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("joined_at", h24);

  const { count: joins7d } = await sb
    .from("joins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("joined_at", d7);

  // Pool health
  const { data: pools } = await sb
    .from("pool_health_vw")
    .select("username, channel_id, unused, burned")
    .eq("user_id", userId)
    .eq("is_active", true);

  // CAPI success rate (24h)
  const { count: capiTotal } = await sb
    .from("capi_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("fired_at", h24);

  const { count: capiOk } = await sb
    .from("capi_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("http_status", 200)
    .gte("fired_at", h24);

  const rate24 = capiTotal && capiTotal > 0
    ? Math.round(((capiOk ?? 0) / capiTotal) * 100)
    : 0;

  // Format message
  const joinRate24 = clicks24h && clicks24h > 0
    ? ((joins24h ?? 0) / clicks24h * 100).toFixed(1)
    : "0";

  let text = `📊 burnlink stats\n\n`;
  text += `Clicks: ${clicks24h ?? 0} (24h) / ${clicks7d ?? 0} (7d)\n`;
  text += `Joins: ${joins24h ?? 0} (24h) / ${joins7d ?? 0} (7d)\n`;
  text += `Join rate (24h): ${joinRate24}%\n`;
  text += `CAPI success (24h): ${rate24}% (${capiOk ?? 0}/${capiTotal ?? 0})\n\n`;

  if (pools && pools.length > 0) {
    text += `Pool health:\n`;
    for (const p of pools) {
      text += `  ${p.username} #${p.channel_id}: ${p.unused} unused, ${p.burned} burned\n`;
    }
  } else {
    text += `No active bots.\n`;
  }

  // Find bot token to reply
  const { data: bot } = await sb
    .from("bots")
    .select("token")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (bot) {
    await tg.sendMessage(bot.token, chatId, text);
  }
}
```

**Step 2: Verify**

- Complete `/start alerts_<user_id>` flow with a bot
- Send `/stats` to the bot in DM
- Expected: bot replies with stats summary

**Step 3: Commit**

```bash
git add app/api/telegram/webhook/[secret]/route.ts
git commit -m "feat: /stats bot command — operator stats summary via Telegram DM"
```

---

## Task 8: Operator alerts library

**Files:**
- Create: `lib/alerts.ts`

**Step 1: Create the alerts module**

```typescript
// Operator alerts — sends urgent notifications via Telegram DM
// and logs to ops_log for dashboard history.

import { serviceClient } from "./supabase/server";
import { tg } from "./telegram";
import { logOps } from "./ops";

export async function sendOperatorAlert(
  userId: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  // Always log to ops_log
  await logOps("warn", "alerts", message, { ...context, user_id: userId });

  const sb = serviceClient();

  // Look up operator's Telegram chat ID
  const { data: settings } = await sb
    .from("user_settings")
    .select("telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();

  if (!settings?.telegram_chat_id) {
    // No Telegram linked — ops_log entry is sufficient
    return;
  }

  // Find an active bot token to send with
  const { data: bot } = await sb
    .from("bots")
    .select("token")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!bot) return;

  try {
    await tg.sendMessage(bot.token, settings.telegram_chat_id, `⚠️ ${message}`);
  } catch (e) {
    // Alert delivery failure must not break the calling flow
    await logOps("error", "alerts", "Telegram alert delivery failed", {
      user_id: userId,
      error: (e as Error).message,
    });
  }
}
```

**Step 2: Commit**

```bash
git add lib/alerts.ts
git commit -m "feat: operator alert library — Telegram DM + ops_log"
```

---

## Task 9: Wire alerts into pool refill and CAPI

**Files:**
- Modify: `lib/pool.ts` (add low-pool alert)
- Modify: `app/api/telegram/webhook/[secret]/route.ts` (add CAPI failure alert)
- Modify: `app/go/route.ts` (add CAPI failure alert)

**Step 1: Add low-pool alert to refillBot**

In `lib/pool.ts`, after the `unused` count check (around line 37-38), add an alert when pool is critically low:

```typescript
import { sendOperatorAlert } from "./alerts";
```

After line 38 (`if (floor > 0 && unused >= floor) return ...`), before the `const need` line, add:

```typescript
// Alert if pool is critically low (below 100)
if (unused < 100 && bot.channel_id) {
  // Need to find the bot's owner
  const { data: botOwner } = await sb
    .from("bots")
    .select("user_id")
    .eq("id", bot.id)
    .maybeSingle();

  if (botOwner?.user_id) {
    await sendOperatorAlert(
      botOwner.user_id,
      `Pool low: ${bot.username} #${bot.channel_id} has only ${unused} links left`,
      { bot_id: bot.id, unused },
    );
  }
}
```

**Step 2: Add CAPI failure alert in webhook handler**

In the webhook handler, in the `catch` block for CAPI Lead fire (around line 333-338), add:

```typescript
if (botRow?.user_id) {
  const { sendOperatorAlert } = await import("@/lib/alerts");
  await sendOperatorAlert(botRow.user_id, `CAPI Lead fire failed: ${(e as Error).message}`, {
    join_id: joinRow.id,
  });
}
```

**Step 3: Add CAPI failure alert in /go route**

In `app/go/route.ts`, in the `catch` block for PageView (around line 128-133), add:

```typescript
const { sendOperatorAlert } = await import("@/lib/alerts");
await sendOperatorAlert(user.id, `CAPI PageView fire failed: ${(e as Error).message}`, {
  click_id: click.id,
});
```

**Step 4: Commit**

```bash
git add lib/pool.ts app/api/telegram/webhook/[secret]/route.ts app/go/route.ts
git commit -m "feat: wire operator alerts — low pool, CAPI failure notifications"
```

---

## Task 10: "Enable Telegram Alerts" button on dashboard

**Files:**
- Modify: `app/dashboard/bots/BotsClient.tsx` (or create a small component)
- Modify: `app/dashboard/settings/SettingsClient.tsx`

**Step 1: Add alerts setup section to Settings page**

Add a new section in SettingsClient after the Affiliate URL section. This displays a deep link for each active bot:

```tsx
<section>
  <h2 className="text-lg font-semibold mb-3">Telegram Alerts</h2>
  <div className="bg-panel border border-border rounded-xl p-5">
    {initial?.telegram_chat_id ? (
      <p className="text-xs text-green-500">
        ✓ Telegram alerts linked (chat ID: {initial.telegram_chat_id})
      </p>
    ) : (
      <>
        <p className="text-xs text-muted mb-3">
          Click the button below to link your Telegram account for real-time alerts
          (low pool, CAPI failures). You only need to do this once with any of your bots.
        </p>
        {bots.map((b) => (
          <a
            key={b.id}
            href={`https://t.me/${b.username}?start=alerts_${userId}`}
            target="_blank"
            rel="noopener"
            className="inline-block bg-accent text-black font-medium rounded px-3 py-2 text-sm mr-2 mb-2"
          >
            Enable via @{b.username}
          </a>
        ))}
      </>
    )}
  </div>
</section>
```

The settings page server component needs to pass `telegram_chat_id`, user ID, and the user's active bots to the client component. Update the props and server query accordingly.

**Step 2: Update settings page.tsx to pass bots and user ID**

Add a query for active bots:
```typescript
const { data: bots } = await svc
  .from("bots")
  .select("id, username")
  .eq("user_id", auth.user.id)
  .eq("is_active", true);
```

Pass `bots`, `userId: auth.user.id`, and `telegram_chat_id` to SettingsClient.

**Step 3: Verify**

- Open settings page
- See "Enable via @BotName" button
- Click it → opens Telegram → tap Start → bot confirms alerts linked
- Refresh settings → shows "Telegram alerts linked"

**Step 4: Commit**

```bash
git add app/dashboard/settings/SettingsClient.tsx app/dashboard/settings/page.tsx
git commit -m "feat: Telegram alerts setup UI on settings page — one-click /start deep link"
```

---

## Task 11: Dashboard alerts page

**Files:**
- Create: `app/dashboard/alerts/page.tsx`
- Modify: `app/dashboard/layout.tsx` (add tab)

**Step 1: Add Alerts tab to dashboard nav**

In `app/dashboard/layout.tsx:6-13`, add to the tabs array:

```typescript
{ href: "/dashboard/alerts", label: "Alerts" },
```

Place it after "Bots" and before "Settings".

**Step 2: Create alerts page**

```tsx
import { serviceClient, rscClient } from "@/lib/supabase/server";

export default async function AlertsPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();
  const { data: logs } = await svc
    .from("ops_log")
    .select("id, level, source, message, context, at")
    .eq("user_id", auth.user.id)
    .in("level", ["warn", "error"])
    .order("at", { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Alerts</h1>
      {!logs || logs.length === 0 ? (
        <p className="text-sm text-muted">No alerts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Level</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted">
                    {new Date(l.at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        l.level === "error"
                          ? "text-red-400 font-medium"
                          : "text-yellow-400"
                      }
                    >
                      {l.level}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted">{l.source}</td>
                  <td className="py-2">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Verify**

- Navigate to `/dashboard/alerts`
- Expected: shows recent warn/error ops_log entries for the current user

**Step 4: Commit**

```bash
git add app/dashboard/alerts/page.tsx app/dashboard/layout.tsx
git commit -m "feat: dashboard alerts page — warn/error ops_log entries per user"
```

---

## Task 12: Welcome messages configuration UI

**Files:**
- Create: `app/dashboard/messages/page.tsx`
- Create: `app/dashboard/messages/MessagesClient.tsx`
- Create: `app/api/welcome-messages/route.ts`
- Modify: `app/dashboard/layout.tsx` (add tab)

**Step 1: Add Messages tab to dashboard nav**

In `app/dashboard/layout.tsx`, add to the tabs array after "Bots":

```typescript
{ href: "/dashboard/messages", label: "Messages" },
```

**Step 2: Create API route for welcome messages CRUD**

```typescript
// app/api/welcome-messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAuth() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

// GET — list user's welcome messages
export async function GET() {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const sb = serviceClient();
  const { data, error } = await sb
    .from("welcome_messages")
    .select("id, bot_id, channel_id, message, is_active, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// POST — create or update a welcome message for a bot-channel pair
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    bot_id: string;
    channel_id: number;
    message: string;
    is_active?: boolean;
  } | null;

  if (!body?.bot_id || !body.channel_id || !body.message) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const sb = serviceClient();

  // Verify bot ownership
  const { data: bot } = await sb
    .from("bots")
    .select("user_id")
    .eq("id", body.bot_id)
    .maybeSingle();

  if (!bot || bot.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "not your bot" }, { status: 403 });
  }

  // Upsert (unique on bot_id + channel_id)
  const { data, error } = await sb
    .from("welcome_messages")
    .upsert(
      {
        user_id: user.id,
        bot_id: body.bot_id,
        channel_id: body.channel_id,
        message: body.message,
        is_active: body.is_active ?? true,
      },
      { onConflict: "bot_id,channel_id" },
    )
    .select("id, bot_id, channel_id, message, is_active")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// DELETE — remove a welcome message
export async function DELETE(req: NextRequest) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

  const sb = serviceClient();
  const { error } = await sb
    .from("welcome_messages")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

**Step 3: Create Messages page (server component)**

```tsx
// app/dashboard/messages/page.tsx
import { serviceClient, rscClient } from "@/lib/supabase/server";
import MessagesClient from "./MessagesClient";

export default async function MessagesPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();

  const { data: messages } = await svc
    .from("welcome_messages")
    .select("id, bot_id, channel_id, message, is_active")
    .eq("user_id", auth.user.id);

  const { data: bots } = await svc
    .from("bots")
    .select("id, username, channel_id")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .not("channel_id", "is", null);

  return (
    <MessagesClient
      initial={messages ?? []}
      bots={bots ?? []}
    />
  );
}
```

**Step 4: Create MessagesClient**

Build a client component that:
- Lists existing welcome messages with edit/toggle/delete controls
- Shows a form to add a new message for any bot-channel pair that doesn't have one
- Template shows `{out_link}` as the placeholder with a note explaining it
- Uses fetch to `POST /api/welcome-messages` and `DELETE /api/welcome-messages?id=...`

This is a standard CRUD form — follow the same patterns as `BotsClient.tsx` for the layout and state management.

**Step 5: Verify**

- Navigate to `/dashboard/messages`
- Add a welcome message for a bot-channel pair
- Expected: message appears in the list; when a user joins that channel, they receive the DM

**Step 6: Commit**

```bash
git add app/dashboard/messages/page.tsx app/dashboard/messages/MessagesClient.tsx app/api/welcome-messages/route.ts app/dashboard/layout.tsx
git commit -m "feat: welcome messages CRUD — configure DM template per bot-channel pair"
```

---

## Task 13: Re-register existing bot webhooks

**Files:**
- Modify: `scripts/reregister-webhooks.mjs`

The existing `reregister-webhooks.mjs` script needs to be run once after deploying Task 4's `setWebhook` change (adding `"message"` to `allowed_updates`). This ensures existing bots start receiving `/start` and `/stats` commands.

**Step 1: Run the script**

```bash
node scripts/reregister-webhooks.mjs
```

Expected: all active bots re-registered with updated `allowed_updates`.

**Step 2: Commit** (if script needed changes)

No code changes needed — the existing script re-registers all active bots using the current `tg.setWebhook()` which now includes `"message"`.

---

## Task 14: End-to-end verification

**Step 1: Full flow test**

1. Set affiliate URL in settings: `https://example.com`
2. Configure a welcome message for a bot-channel pair
3. Visit `/go?uid=default&fbclid=test123` → expect 302 to `t.me/+...`
4. Join channel in Telegram → expect DM with `/out` link
5. Click the `/out` link in the DM → expect 302 to `https://example.com`
6. Check `out_clicks` table → expect a row with `join_id` populated
7. Check `capi_events` table → expect an InitiateCheckout row

**Step 2: Test /start and /stats**

1. Open `t.me/<bot>?start=alerts_<user_id>` → tap Start
2. Expected: bot replies "Alerts enabled!"
3. Send `/stats` to bot → expected: stats summary reply

**Step 3: Test alerts**

1. Manually deplete a pool below 100 unused links
2. Trigger cron refill
3. Expected: receive Telegram DM alert about low pool + entry in `/dashboard/alerts`

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: e2e verification fixes for Phase 4 bot automation"
```
