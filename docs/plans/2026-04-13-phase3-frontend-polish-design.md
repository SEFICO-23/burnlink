# Phase 3: Frontend Polish — Design Document

**Date:** 2026-04-13
**Status:** Approved

## Goal

Polish burnlink's frontend with a light/dark theme toggle, responsive mobile layout, and a 30-day overview chart — making it feel like a finished product for both the operator and new users.

## Scope — Three Items Only

| Priority | Feature | Summary |
|---|---|---|
| 1 | Light/dark toggle | CSS variables + Tailwind `dark:` class, sun/moon button, localStorage |
| 2 | Responsive/mobile | Mobile-first breakpoints, scrollable tables, responsive nav |
| 3 | Charts | recharts, 30-day clicks/joins line chart on overview page |

**Out of scope:** active nav states, empty state illustrations, loading skeletons, better table styling, sidebar layout, redesign.

## Locked Decisions

| Decision | Choice |
|---|---|
| Theme approach | CSS variables in `:root` / `.dark`, Tailwind resolves via `var()` |
| Default theme | Dark (preserves current behavior) |
| Flash prevention | Inline `<script>` in root layout reads localStorage before paint |
| Charting library | recharts (~45kB gzip) |
| Chart placement | Overview page only — 30-day line chart (clicks + joins) |
| Mobile tables | `overflow-x-auto` scroll, no card reflow |
| Mobile nav | Horizontally scrollable tabs, no hamburger menu |

## Design Details

### 1. Light/Dark Theme System

**CSS variable tokens** defined in `globals.css`:

```
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
```

**Tailwind config** changes from hardcoded hex to `var()`:

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
}
```

All existing class names (`bg-bg`, `text-muted`, `border-border`, etc.) keep working — they resolve to different values based on theme.

**Theme toggle button:** Sun/moon icon in header. Present in dashboard layout, admin layout, and landing page nav.

**Flash prevention:** Inline `<script>` in `app/layout.tsx` `<head>` that reads `localStorage.getItem("theme")` and applies `.dark` class before first paint. Default = dark.

**Theme toggle component:** `lib/components/ThemeToggle.tsx` — client component. Toggles `dark` class on `<html>` and persists to localStorage.

### 2. Responsive/Mobile

**Navigation (dashboard + admin):**
- `<md`: tabs in a horizontally scrollable row (`overflow-x-auto whitespace-nowrap`)
- `md+`: current horizontal layout unchanged

**Stat cards:** Already `grid-cols-2 md:grid-cols-4` — no change needed.

**Funnel tab switcher:** Stacks above table on mobile with `flex-col md:flex-row`.

**All tables:** Wrap in `<div className="overflow-x-auto">`. Reduce padding: `p-2 md:p-3`.

**Landing page:** Verify hero text scales, nav doesn't overflow on 375px. Grid sections already use `md:` breakpoints.

**Forms (settings, bots, onboarding):** Already single-column. Verify no overflow at 375px.

### 3. Charts

**Library:** `recharts` — install via `npm install recharts`.

**Overview page — 30-day line chart:**
- Two lines: clicks (muted color) and joins (accent color)
- X-axis: date labels. Y-axis: count.
- Tooltip on hover with exact date + counts
- Uses CSS variable colors for theme compatibility
- Responsive via recharts `<ResponsiveContainer>`

**Data query:** New server-side query in overview page — daily counts for last 30 days:
```sql
SELECT date_trunc('day', received_at)::date as day, count(*) as count
FROM clicks WHERE received_at >= now() - interval '30 days'
GROUP BY day ORDER BY day
```
Same for joins (using `joined_at`).

**Component structure:**
- `app/dashboard/ChartSection.tsx` — client component (`"use client"`)
- Overview `page.tsx` (server component) fetches data, passes as props
- Chart reads CSS variables for line colors

**No charts on other pages.** Funnel, pool, events, bots stay as tables.

## Files That Change

| File | Change |
|---|---|
| `app/globals.css` | CSS variable definitions for light/dark |
| `tailwind.config.ts` | Colors from hex → `var()` |
| `app/layout.tsx` | Inline theme script in `<head>` |
| `lib/components/ThemeToggle.tsx` | New — sun/moon toggle button |
| `app/dashboard/layout.tsx` | Add ThemeToggle to header, scrollable nav |
| `app/admin/layout.tsx` | Add ThemeToggle to header, scrollable nav |
| `app/page.tsx` | Add ThemeToggle to landing nav |
| `app/dashboard/page.tsx` | Add chart section, pass daily data |
| `app/dashboard/ChartSection.tsx` | New — recharts line chart client component |
| `app/dashboard/funnel/page.tsx` | Responsive tab switcher |
| `app/dashboard/pool/page.tsx` | Scrollable table wrapper |
| `app/dashboard/events/page.tsx` | Scrollable table wrapper |
| `app/dashboard/bots/BotsClient.tsx` | Scrollable table wrapper |
| `app/dashboard/settings/SettingsClient.tsx` | Verify mobile layout |
| `package.json` | Add recharts dependency |
