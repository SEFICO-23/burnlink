# Phase 3: Frontend Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add light/dark theme toggle, responsive mobile layout, and a 30-day overview chart to make burnlink feel like a finished product.

**Architecture:** CSS custom properties define color tokens for light/dark modes. Tailwind config references these via `var()`. An inline script in the root layout prevents flash-of-wrong-theme. recharts renders a 30-day clicks/joins line chart on the overview page. All tables get `overflow-x-auto` for mobile.

**Tech Stack:** Next.js 15, Tailwind CSS (CSS variables), recharts, localStorage

**Design doc:** `docs/plans/2026-04-13-phase3-frontend-polish-design.md`

---

## Important Context

- **Current color config** (`tailwind.config.ts`): hardcoded hex values like `bg: "#0a0a0b"`. These become `bg: "var(--color-bg)"`.
- **Current `globals.css`**: just Tailwind directives + hardcoded body styles. Becomes the home for CSS variable definitions.
- **`app/layout.tsx`**: minimal — just metadata + body wrapper. Needs the inline theme script.
- **All existing classes** like `bg-bg`, `text-muted`, `border-border` keep working — they resolve to CSS variables instead of hex.
- **Dashboard layout** (`app/dashboard/layout.tsx`): horizontal tab nav + header. Needs ThemeToggle + responsive nav.
- **Admin layout** (`app/admin/layout.tsx`): same pattern. Needs ThemeToggle + responsive nav.
- **Landing page** (`app/page.tsx`): has its own nav. Needs ThemeToggle.
- **Security note:** The inline theme script uses `dangerouslySetInnerHTML` with a hardcoded string constant — no user input, no XSS risk. This is the standard pattern for flash-free theme switching in Next.js.

---

### Task 1: CSS Variables + Tailwind Config

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`

**Step 1: Define CSS variable tokens in globals.css**

Replace the entire `globals.css` content:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-bg: #ffffff;
  --color-panel: #f5f5f7;
  --color-border: #e2e2e5;
  --color-text: #1a1a1b;
  --color-muted: #6b6b73;
  --color-accent: #ff5a1f;
  --color-ok: #16a34a;
  --color-warn: #ca8a04;
  --color-err: #dc2626;
}

.dark {
  --color-bg: #0a0a0b;
  --color-panel: #131316;
  --color-border: #24242a;
  --color-text: #e8e8ec;
  --color-muted: #8a8a93;
  --color-accent: #ff5a1f;
  --color-ok: #22c55e;
  --color-warn: #eab308;
  --color-err: #ef4444;
}

html, body {
  background-color: var(--color-bg);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
}
```

**Step 2: Update tailwind.config.ts colors to use CSS variables**

Replace the `colors` object:

```typescript
colors: {
  bg: "var(--color-bg)",
  panel: "var(--color-panel)",
  border: "var(--color-border)",
  text: "var(--color-text)",
  muted: "var(--color-muted)",
  accent: "var(--color-accent)",
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  err: "var(--color-err)",
},
```

**Step 3: Verify build**

```bash
npx next build
```
Expected: passes — all existing class names resolve to CSS variables. The site looks identical in dark mode.

**Step 4: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat: CSS variable color tokens with light/dark definitions"
```

---

### Task 2: Theme Toggle Component + Inline Script

**Files:**
- Create: `lib/components/ThemeToggle.tsx`
- Modify: `app/layout.tsx`

**Step 1: Create the ThemeToggle client component**

```tsx
"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="p-1.5 rounded border border-border text-muted hover:text-text transition"
    >
      {dark ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.061l1.061-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.061l1.061-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.061 1.06l1.06 1.061ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.061 1.06l1.06 1.061Z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}
```

**Step 2: Add inline theme script to root layout**

In `app/layout.tsx`, add a `<script>` tag inside `<head>` that applies the theme class before paint. The script is a hardcoded constant string (no user input — safe to use with dangerouslySetInnerHTML):

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "burnlink",
  description: "FB Ads → private Telegram channel tracker",
};

const themeScript = `
  (function() {
    var t = localStorage.getItem('theme');
    if (t === 'light') return;
    document.documentElement.classList.add('dark');
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-text font-sans">{children}</body>
    </html>
  );
}
```

**Step 3: Verify build**

```bash
npx next build
```

**Step 4: Commit**

```bash
git add lib/components/ThemeToggle.tsx app/layout.tsx
git commit -m "feat: ThemeToggle component + inline script for flash-free theme switching"
```

---

### Task 3: Add ThemeToggle to All Layouts

**Files:**
- Modify: `app/dashboard/layout.tsx`
- Modify: `app/admin/layout.tsx`
- Modify: `app/page.tsx` (landing page)
- Modify: `app/login/page.tsx`
- Modify: `app/onboarding/page.tsx`

**Step 1: Dashboard layout**

Import and add `ThemeToggle` next to the email display:

```tsx
import ThemeToggle from "@/lib/components/ThemeToggle";
```

In the header, update the right-side div:

```tsx
<div className="ml-auto flex items-center gap-3 text-xs text-muted">
  {settings?.is_admin && (
    <Link href="/admin" className="text-accent hover:underline">
      Admin
    </Link>
  )}
  <span>{data.user.email}</span>
  <ThemeToggle />
</div>
```

**Step 2: Admin layout**

Import and add `ThemeToggle` to the header, same pattern:

```tsx
import ThemeToggle from "@/lib/components/ThemeToggle";
```

```tsx
<div className="ml-auto flex items-center gap-3 text-xs text-muted">
  <Link href="/dashboard" className="hover:text-text transition">
    My Dashboard
  </Link>
  <span>{data.user.email}</span>
  <ThemeToggle />
</div>
```

**Step 3: Landing page**

Import and add `ThemeToggle` to the nav bar:

```tsx
import ThemeToggle from "@/lib/components/ThemeToggle";
```

In the header `<div>`, add `<ThemeToggle />` alongside the sign-in/dashboard buttons.

**Step 4: Login page**

Add `ThemeToggle` in a fixed position:

```tsx
import ThemeToggle from "@/lib/components/ThemeToggle";
```

Add inside the `<main>` wrapper:

```tsx
<div className="fixed top-4 right-4">
  <ThemeToggle />
</div>
```

**Step 5: Onboarding page**

Same as login — fixed position toggle:

```tsx
import ThemeToggle from "@/lib/components/ThemeToggle";
```

```tsx
<div className="fixed top-4 right-4">
  <ThemeToggle />
</div>
```

**Step 6: Verify build + test both themes**

```bash
npx next build
```

**Step 7: Commit**

```bash
git add app/dashboard/layout.tsx app/admin/layout.tsx app/page.tsx app/login/page.tsx app/onboarding/page.tsx
git commit -m "feat: add ThemeToggle to all layouts — dashboard, admin, landing, login, onboarding"
```

---

### Task 4: Responsive Navigation

**Files:**
- Modify: `app/dashboard/layout.tsx`
- Modify: `app/admin/layout.tsx`

**Step 1: Make dashboard nav scrollable on mobile**

In `app/dashboard/layout.tsx`, update the `<nav>`:

```tsx
<nav className="flex gap-4 text-sm overflow-x-auto whitespace-nowrap">
```

Update the header inner `<div>` for tighter mobile padding:

```tsx
<div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-4 md:gap-8">
```

**Step 2: Same for admin layout**

Apply identical changes to `app/admin/layout.tsx`.

**Step 3: Verify on 375px viewport**

**Step 4: Commit**

```bash
git add app/dashboard/layout.tsx app/admin/layout.tsx
git commit -m "feat: responsive nav — horizontally scrollable tabs on mobile"
```

---

### Task 5: Responsive Tables

**Files:**
- Modify: `app/dashboard/funnel/page.tsx`
- Modify: `app/dashboard/pool/page.tsx`
- Modify: `app/dashboard/events/page.tsx`
- Modify: `app/dashboard/bots/BotsClient.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/ops/page.tsx`
- Modify: `app/admin/users/[id]/page.tsx`

**Step 1: Change `overflow-hidden` to `overflow-x-auto` on every table wrapper**

In each file, find `<div className="bg-panel border border-border rounded-xl overflow-hidden">` that wraps a `<table>` and change to:

```tsx
<div className="bg-panel border border-border rounded-xl overflow-x-auto">
```

**Step 2: Update funnel page tab switcher for mobile**

In `app/dashboard/funnel/page.tsx`, change the header layout:

```tsx
<div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
  <h2 className="text-lg font-semibold">Funnel — last 30 days</h2>
  <div className="md:ml-auto flex gap-2 text-xs">
```

**Step 3: Reduce table padding on mobile**

For every `<th>` and `<td>` in dashboard and admin tables, change `p-3` to `p-2 md:p-3`. For events page tables (which already use `p-2`), no change needed.

**Step 4: Verify on 375px viewport**

**Step 5: Commit**

```bash
git add app/dashboard/funnel/page.tsx app/dashboard/pool/page.tsx app/dashboard/events/page.tsx app/dashboard/bots/BotsClient.tsx app/admin/page.tsx app/admin/ops/page.tsx app/admin/users/[id]/page.tsx
git commit -m "feat: responsive tables — overflow-x-auto + mobile padding"
```

---

### Task 6: Install recharts

**Files:**
- Modify: `package.json`

**Step 1: Install recharts**

```bash
npm install recharts
```

**Step 2: Verify build**

```bash
npx next build
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add recharts dependency"
```

---

### Task 7: Overview Chart — Data Query + Chart Component

**Files:**
- Create: `app/dashboard/ChartSection.tsx`
- Modify: `app/dashboard/page.tsx`

**Step 1: Create the chart client component**

```tsx
"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DayData {
  day: string;
  clicks: number;
  joins: number;
}

export default function ChartSection({ data }: { data: DayData[] }) {
  if (data.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Last 30 days</h2>
      <div className="bg-panel border border-border rounded-xl p-4 md:p-6">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickFormatter={(v: string) => {
                const d = new Date(v);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
              stroke="var(--color-border)"
            />
            <YAxis
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              stroke="var(--color-border)"
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-panel)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-text)",
                fontSize: 12,
              }}
              labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
            />
            <Line
              type="monotone"
              dataKey="clicks"
              stroke="var(--color-muted)"
              strokeWidth={2}
              dot={false}
              name="Clicks"
            />
            <Line
              type="monotone"
              dataKey="joins"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
              name="Joins"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

**Step 2: Add daily data query to overview page**

In `app/dashboard/page.tsx`, add a `dailyCounts` function after the existing helpers:

```typescript
async function dailyCounts(days: number) {
  const sb = await rscClient();
  const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();

  const { data: clicks } = await sb
    .from("clicks")
    .select("received_at")
    .gte("received_at", since);

  const { data: joins } = await sb
    .from("joins")
    .select("joined_at")
    .gte("joined_at", since);

  const map = new Map<string, { clicks: number; joins: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 24 * 3600e3);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { clicks: 0, joins: 0 });
  }

  for (const c of clicks ?? []) {
    const key = new Date(c.received_at).toISOString().slice(0, 10);
    const entry = map.get(key);
    if (entry) entry.clicks++;
  }

  for (const j of joins ?? []) {
    const key = new Date(j.joined_at).toISOString().slice(0, 10);
    const entry = map.get(key);
    if (entry) entry.joins++;
  }

  return [...map.entries()].map(([day, v]) => ({ day, ...v }));
}
```

In the `Overview` component, call it alongside existing queries:

```typescript
const daily = await dailyCounts(30);
```

Import and render ChartSection after the "Last 24h" section:

```tsx
import ChartSection from "./ChartSection";
```

```tsx
{/* After the Last 24h section */}
<ChartSection data={daily} />
```

**Step 3: Verify build**

```bash
npx next build
```

**Step 4: Commit**

```bash
git add app/dashboard/ChartSection.tsx app/dashboard/page.tsx
git commit -m "feat: 30-day clicks/joins line chart on overview page"
```

---

### Task 8: Verify Full Build + Push

**Step 1: Full build**

```bash
npx next build
```
Expected: 0 errors, all routes compile.

**Step 2: Push**

```bash
git push
```

**Step 3: Manual verification after deploy**

1. Visit landing page — click theme toggle — should switch to light mode
2. Refresh — theme persists (no flash)
3. Navigate to `/dashboard` — toggle visible, theme carries over
4. Overview page shows 30-day line chart below the stat cards
5. Resize browser to 375px — nav scrolls horizontally, tables scroll, cards stack to 2-col
6. Check `/admin` — toggle works, tables scroll on mobile
7. Check `/login` and `/onboarding` — toggle in top-right corner

---

## Task Dependency Graph

```
Task 1 (CSS vars + Tailwind) --> Task 2 (ThemeToggle + script)
                                       |
                                       v
                                  Task 3 (add toggle to all layouts)
                                       |
                                       +--> Task 4 (responsive nav)
                                       |
                                       +--> Task 5 (responsive tables)

Task 6 (install recharts) --> Task 7 (chart component + overview)

All --> Task 8 (verify + push)
```

**Parallel groups:**
- **Group A:** Tasks 1, 2, 3 (theme system — must be sequential)
- **Group B:** Tasks 4 + 5 (responsive — independent of each other, need Task 3 done)
- **Group C:** Tasks 6, 7 (charts — independent of theme work)
- **Task 8:** after all groups complete
