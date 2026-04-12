// Helpers used by /go and the Telegram webhook to build click / user_data records.

import type { NextRequest } from "next/server";

export interface ClickContext {
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  event_source_url: string;
}

export function extractClickContext(req: NextRequest): ClickContext {
  const url = new URL(req.url);
  const q = url.searchParams;

  const fbclid = q.get("fbclid");
  const fbpCookie = req.cookies.get("_fbp")?.value ?? null;
  const fbcCookie = req.cookies.get("_fbc")?.value ?? null;

  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = (xff.split(",")[0] || "").trim() || null;

  return {
    fbclid,
    fbc: fbcCookie ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}` : null),
    fbp: fbpCookie,
    utm_source: q.get("utm_source"),
    utm_medium: q.get("utm_medium"),
    utm_campaign: q.get("utm_campaign"),
    utm_content: q.get("utm_content"),
    utm_term: q.get("utm_term"),
    ip,
    user_agent: req.headers.get("user-agent"),
    country: req.headers.get("x-vercel-ip-country") ?? null,
    event_source_url: url.toString(),
  };
}
