# Phase 2: Landing Page + Admin Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a public marketing landing page at `/` that converts visitors into signups, and an admin panel at `/admin` for the platform operator to monitor all users, bots, and global stats.

**Architecture:** The landing page is a static RSC page with Tailwind — no client JS needed. The admin panel is a server-rendered dashboard gated by `is_admin` on `user_settings`, with pages for users list, global stats, user drill-down, and global ops log. Both use the existing dark theme (#0a0a0b bg, #ff5a1f accent).

**Tech Stack:** Next.js 15 (App Router, RSC), Tailwind CSS, Supabase service client

**Design doc:** `docs/plans/2026-04-13-multi-tenant-saas-design.md` (sections 5 + 7)

---

## Important Context

- **Current `/` route** (`app/page.tsx`): redirects authenticated users to `/dashboard`, others to `/login`. This becomes the landing page.
- **Color palette:** bg=#0a0a0b, panel=#131316, border=#24242a, text=#e8e8ec, muted=#8a8a93, accent=#ff5a1f
- **Middleware** (`middleware.ts`): already gates `/admin/:path*` — requires authentication. Admin authorization (is_admin check) is done in the admin layout.
- **`user_settings` table:** has `is_admin boolean`, `slug`, `display_name`, `fb_pixel_id`, `fb_capi_token`, `created_at`
- **`serviceClient()`** bypasses RLS — needed for admin queries across all users.

---

### Task 1: Landing Page

**Files:**
- Rewrite: `app/page.tsx`

**Step 1: Rewrite the root page as a marketing landing page**

Replace the redirect-only page with a full static landing page. Authenticated users see a "Go to Dashboard" button instead of "Get started."

```tsx
import Link from "next/link";
import { rscClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  const isAuthed = !!data.user;

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-semibold text-lg">burnlink</div>
          <div className="flex items-center gap-4 text-sm">
            {isAuthed ? (
              <Link href="/dashboard" className="bg-accent text-black font-medium rounded px-4 py-2">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-muted hover:text-text transition">
                  Sign in
                </Link>
                <Link href="/login" className="bg-accent text-black font-medium rounded px-4 py-2">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 md:py-32">
        <h1 className="text-4xl md:text-5xl font-bold leading-tight max-w-2xl">
          Track Facebook ad conversions into your Telegram channel
        </h1>
        <p className="mt-6 text-lg text-muted max-w-xl">
          burnlink bridges the gap between Facebook Ads and private Telegram channels
          with server-side CAPI attribution. Know exactly which ads drive real channel joins.
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/login"
            className="bg-accent text-black font-semibold rounded-lg px-6 py-3 text-sm hover:opacity-90 transition"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-10">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "User clicks your ad",
                desc: "Facebook sends the click to your burnlink tracking URL with fbclid and UTM params attached.",
              },
              {
                step: "2",
                title: "burnlink bridges the gap",
                desc: "We capture attribution data, fire a CAPI PageView, and instantly redirect to a single-use Telegram invite link.",
              },
              {
                step: "3",
                title: "User joins, CAPI fires",
                desc: "When they join your channel, we match the invite link back to the click and fire a CAPI Lead event to Facebook.",
              },
            ].map((s) => (
              <div key={s.step} className="bg-panel border border-border rounded-xl p-6">
                <div className="text-accent font-bold text-2xl mb-3">{s.step}</div>
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-10">Features</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                title: "Server-side CAPI",
                desc: "PageView on click, Lead on join. Hashed user data for high match quality. No client-side pixel needed.",
              },
              {
                title: "Burn-link pool",
                desc: "Pre-generated single-use invite links. Automatic refill via cron. Never run out of links during a campaign.",
              },
              {
                title: "Auto-discovery",
                desc: "Paste a bot token and we register the webhook. Add the bot to any channel — burnlink detects it automatically.",
              },
              {
                title: "Real-time dashboard",
                desc: "Clicks, joins, join rate, CAPI success rate. Funnel breakdown by UTM campaign, source, and content.",
              },
            ].map((f) => (
              <div key={f.title} className="bg-panel border border-border rounded-xl p-6">
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-20 text-center">
          <h2 className="text-2xl md:text-3xl font-bold">
            Start tracking your Telegram conversions
          </h2>
          <p className="mt-4 text-muted">Free to use. No credit card required.</p>
          <Link
            href="/login"
            className="mt-6 inline-block bg-accent text-black font-semibold rounded-lg px-8 py-3 text-sm hover:opacity-90 transition"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-muted">
          <div>burnlink</div>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-text transition">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
npx next build
```

**Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: marketing landing page at / with hero, how-it-works, features, CTA"
```

---

### Task 2: Admin Layout + Auth Gate

**Files:**
- Create: `app/admin/layout.tsx`

**Step 1: Write the admin layout with is_admin check**

```tsx
import Link from "next/link";
import { rscClient, serviceClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";

const tabs = [
  { href: "/admin", label: "Users" },
  { href: "/admin/stats", label: "Global Stats" },
  { href: "/admin/ops", label: "Ops Log" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("is_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  // Non-admins get 404 (don't reveal the route exists)
  if (!settings?.is_admin) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-8">
          <Link href="/admin" className="font-semibold text-lg">
            burnlink <span className="text-accent text-sm font-normal ml-1">admin</span>
          </Link>
          <nav className="flex gap-4 text-sm">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="text-muted hover:text-text transition"
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-xs text-muted">
            <Link href="/dashboard" className="hover:text-text transition">
              My Dashboard
            </Link>
            <span>{data.user.email}</span>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
npx next build
```

**Step 3: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat: admin layout with is_admin gate, returns 404 for non-admins"
```

---

### Task 3: Admin Users List Page

**Files:**
- Create: `app/admin/page.tsx`

**Step 1: Write the users list page**

```tsx
import Link from "next/link";
import { serviceClient } from "@/lib/supabase/server";

export default async function AdminUsersPage() {
  const sb = serviceClient();

  const { data: users } = await sb
    .from("user_settings")
    .select("id, display_name, slug, is_admin, created_at, fb_pixel_id")
    .order("created_at", { ascending: false });

  // Get bot counts per user
  const { data: botCounts } = await sb
    .from("bots")
    .select("user_id")
    .eq("is_active", true);

  const botCountMap = new Map<string, number>();
  for (const b of botCounts ?? []) {
    botCountMap.set(b.user_id, (botCountMap.get(b.user_id) ?? 0) + 1);
  }

  // Get user emails from auth (service client can query auth.users via admin API)
  // We'll use the Supabase admin listUsers API
  const { data: authData } = await sb.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  for (const u of authData?.users ?? []) {
    emailMap.set(u.id, u.email ?? "—");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users ({users?.length ?? 0})</h1>
      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr className="text-left">
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Slug</th>
              <th className="p-3 font-medium">Bots</th>
              <th className="p-3 font-medium">Pixel</th>
              <th className="p-3 font-medium">Admin</th>
              <th className="p-3 font-medium">Joined</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-3 text-xs">{emailMap.get(u.id) ?? "—"}</td>
                <td className="p-3 text-xs">{u.display_name ?? "—"}</td>
                <td className="p-3 font-mono text-xs">{u.slug}</td>
                <td className="p-3 text-xs">{botCountMap.get(u.id) ?? 0}</td>
                <td className="p-3 text-xs">
                  {u.fb_pixel_id ? (
                    <span className="text-ok">configured</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="p-3 text-xs">
                  {u.is_admin ? <span className="text-accent">admin</span> : "—"}
                </td>
                <td className="p-3 text-xs text-muted">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="p-3 text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    view
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: admin users list — email, slug, bots, pixel status, join date"
```

---

### Task 4: Admin Global Stats Page

**Files:**
- Create: `app/admin/stats/page.tsx`

**Step 1: Write the global stats page**

```tsx
import { serviceClient } from "@/lib/supabase/server";

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function AdminStatsPage() {
  const sb = serviceClient();

  const [users, bots, clicks, joins, capiOk, capiFail, linksUnused] = await Promise.all([
    sb.from("user_settings").select("id", { count: "exact", head: true }),
    sb.from("bots").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("clicks").select("id", { count: "exact", head: true }),
    sb.from("joins").select("id", { count: "exact", head: true }),
    sb.from("capi_events").select("id", { count: "exact", head: true }).eq("http_status", 200),
    sb.from("capi_events").select("id", { count: "exact", head: true }).neq("http_status", 200),
    sb.from("invite_links").select("id", { count: "exact", head: true }).eq("status", "unused"),
  ]);

  const totalCapi = (capiOk.count ?? 0) + (capiFail.count ?? 0);
  const capiRate = totalCapi > 0
    ? `${Math.round(((capiOk.count ?? 0) / totalCapi) * 100)}%`
    : "—";

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Global Stats</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Users" value={users.count ?? 0} />
        <Card label="Active Bots" value={bots.count ?? 0} />
        <Card label="Total Clicks" value={clicks.count ?? 0} />
        <Card label="Total Joins" value={joins.count ?? 0} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          label="Join Rate"
          value={
            (clicks.count ?? 0) > 0
              ? `${(((joins.count ?? 0) / (clicks.count ?? 1)) * 100).toFixed(1)}%`
              : "—"
          }
        />
        <Card label="CAPI Success Rate" value={capiRate} hint={`${capiOk.count ?? 0} / ${totalCapi}`} />
        <Card label="Unused Links" value={linksUnused.count ?? 0} />
        <Card label="—" value="" />
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/admin/stats/page.tsx
git commit -m "feat: admin global stats — users, bots, clicks, joins, CAPI rate, pool"
```

---

### Task 5: Admin User Drill-Down Page

**Files:**
- Create: `app/admin/users/[id]/page.tsx`

**Step 1: Write the user drill-down page**

```tsx
import Link from "next/link";
import { serviceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = serviceClient();

  const { data: settings } = await sb
    .from("user_settings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!settings) notFound();

  // Get email
  const { data: authData } = await sb.auth.admin.getUserById(id);
  const email = authData?.user?.email ?? "—";

  // Get bots
  const { data: bots } = await sb
    .from("bots")
    .select("id, username, channel_id, telegram_id, is_active, last_refill_at, last_error")
    .eq("user_id", id)
    .order("created_at", { ascending: false });

  // Get counts
  const [clickCount, joinCount, capiCount] = await Promise.all([
    sb.from("clicks").select("id", { count: "exact", head: true }).eq("user_id", id),
    sb.from("joins").select("id", { count: "exact", head: true }).eq("user_id", id),
    sb.from("capi_events").select("id", { count: "exact", head: true }).eq("user_id", id),
  ]);

  // Pool health per bot
  const poolData: Array<{ bot: string; unused: number }> = [];
  for (const bot of bots ?? []) {
    const { count } = await sb
      .from("invite_links")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", bot.id)
      .eq("status", "unused");
    poolData.push({ bot: bot.username, unused: count ?? 0 });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="text-muted hover:text-text text-sm">&larr; Users</Link>
        <h1 className="text-xl font-semibold">{settings.display_name ?? email}</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Email</div>
          <div className="mt-2 text-sm">{email}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Slug</div>
          <div className="mt-2 font-mono text-sm">{settings.slug}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Pixel</div>
          <div className="mt-2 text-sm">{settings.fb_pixel_id ?? <span className="text-muted">not set</span>}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Joined</div>
          <div className="mt-2 text-sm">{new Date(settings.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Clicks</div>
          <div className="mt-2 text-2xl font-semibold">{clickCount.count ?? 0}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Joins</div>
          <div className="mt-2 text-2xl font-semibold">{joinCount.count ?? 0}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">CAPI Events</div>
          <div className="mt-2 text-2xl font-semibold">{capiCount.count ?? 0}</div>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Bots ({bots?.length ?? 0})</h2>
        <div className="bg-panel border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr className="text-left">
                <th className="p-3 font-medium">Bot</th>
                <th className="p-3 font-medium">Channel</th>
                <th className="p-3 font-medium">Unused Links</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Last Refill</th>
                <th className="p-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {(bots ?? []).map((b, i) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="p-3 font-mono text-xs">{b.username}</td>
                  <td className="p-3 font-mono text-xs">{b.channel_id ?? <span className="text-warn italic">pending</span>}</td>
                  <td className="p-3 text-xs">{poolData[i]?.unused ?? 0}</td>
                  <td className="p-3 text-xs">
                    <span className={b.is_active ? "text-ok" : "text-muted"}>
                      {b.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted">
                    {b.last_refill_at ? new Date(b.last_refill_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-xs text-err">{b.last_error ?? "—"}</td>
                </tr>
              ))}
              {(!bots || bots.length === 0) && (
                <tr><td colSpan={6} className="p-6 text-center text-muted">No bots</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/admin/users/[id]/page.tsx
git commit -m "feat: admin user drill-down — email, slug, pixel, bots, pool, clicks, joins"
```

---

### Task 6: Admin Global Ops Log Page

**Files:**
- Create: `app/admin/ops/page.tsx`

**Step 1: Write the ops log page**

```tsx
import { serviceClient } from "@/lib/supabase/server";

export default async function AdminOpsPage() {
  const sb = serviceClient();

  const { data: logs } = await sb
    .from("ops_log")
    .select("id, level, source, message, context, at, user_id")
    .order("at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Ops Log (last 100)</h1>
      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr className="text-left">
              <th className="p-3 font-medium">Time</th>
              <th className="p-3 font-medium">Level</th>
              <th className="p-3 font-medium">Source</th>
              <th className="p-3 font-medium">Message</th>
              <th className="p-3 font-medium">Context</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-3 text-xs text-muted whitespace-nowrap">
                  {new Date(r.at).toLocaleString()}
                </td>
                <td className="p-3 text-xs">
                  <span
                    className={
                      r.level === "error"
                        ? "text-err"
                        : r.level === "warn"
                          ? "text-warn"
                          : "text-muted"
                    }
                  >
                    {r.level}
                  </span>
                </td>
                <td className="p-3 text-xs font-mono">{r.source}</td>
                <td className="p-3 text-xs">{r.message}</td>
                <td className="p-3 text-xs font-mono text-muted max-w-xs truncate">
                  {r.context ? JSON.stringify(r.context) : "—"}
                </td>
              </tr>
            ))}
            {(!logs || logs.length === 0) && (
              <tr><td colSpan={5} className="p-6 text-center text-muted">No entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/admin/ops/page.tsx
git commit -m "feat: admin global ops log — last 100 entries across all users"
```

---

### Task 7: Add Admin Link to Dashboard (for admins only)

**Files:**
- Modify: `app/dashboard/layout.tsx`

**Step 1: Show admin link conditionally**

Update the dashboard layout to check `is_admin` and show an "Admin" link in the header if true.

After the existing `user_settings` query (which currently only selects `id`), change to also select `is_admin`:

```typescript
const { data: settings } = await svc
  .from("user_settings")
  .select("id, is_admin")
  .eq("id", data.user.id)
  .maybeSingle();
```

Then in the header, after the email display, conditionally show the admin link:

```tsx
<div className="ml-auto flex items-center gap-4 text-xs text-muted">
  {settings?.is_admin && (
    <Link href="/admin" className="text-accent hover:underline">
      Admin
    </Link>
  )}
  <span>{data.user.email}</span>
</div>
```

**Step 2: Verify build**

```bash
npx next build
```

**Step 3: Commit**

```bash
git add app/dashboard/layout.tsx
git commit -m "feat: show Admin link in dashboard header for admin users"
```

---

### Task 8: Verify Full Build + Push

**Step 1: Full build**

```bash
npx next build
```
Expected: 0 errors, all routes including new `/admin/*` pages.

**Step 2: Commit any remaining fixes, push**

```bash
git push
```

**Step 3: Manual verification after deploy**

1. Visit `https://burnlink-orcin.vercel.app/` — should show the landing page
2. Click "Get started" — should go to `/login`
3. Log in as operator → dashboard should show "Admin" link in header
4. Visit `/admin` — should show users list with your account
5. Visit `/admin/stats` — should show global stats
6. Visit `/admin/ops` — should show ops log entries
7. Click "view" on your user → should show drill-down with bots and pool
8. In an incognito window, visit `/admin` without logging in → should redirect to `/login`
9. Log in as a non-admin user → visit `/admin` → should get 404

---

## Task Dependency Graph

```
Task 1 (landing page) ─────────────────────┐
                                            │
Task 2 (admin layout) ──► Task 3 (users)   │
                      ├──► Task 4 (stats)   ├── all independent
                      ├──► Task 5 (drill)   │
                      └──► Task 6 (ops)     │
                                            │
Task 7 (admin link in dashboard) ───────────┘
                                            │
                                   Task 8 (verify)
```

Task 1 is independent. Tasks 3-6 depend on Task 2 (admin layout). Task 7 is independent. Task 8 is last.
