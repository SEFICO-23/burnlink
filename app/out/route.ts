// Affiliate click-out redirect.
//
// /out?uid=<slug>&jid=<join_id> ->
//   1) resolve uid slug -> user_settings (user_id + credentials + affiliate_url)
//   2) best-effort: jid -> joins -> clicks -> original fbclid/fbc/fbp/ip/ua/country
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

  // 2. Best-effort attribution via join -> click
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
        kind: "InitiateCheckout",
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
