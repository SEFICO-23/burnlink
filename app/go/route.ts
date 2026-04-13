// The attribution bridge.
//
// FB ad → /go?uid=slug&fbclid=...&utm_* → this handler →
//   1) resolve uid slug → user_settings row (user_id + FB credentials)
//   2) capture click row (with all ad params, IP, UA, country, user_id)
//   3) atomically pop one unused burn invite link via pop_unused_link(click_id, user_id)
//   4) link click.assigned_link_id to that link
//   5) fire-and-forget CAPI PageView with user's FB credentials (after response)
//   6) 302 to the Telegram invite link
//
// If the pool is fully drained, insert the click anyway and 302 to /sold-out.

import { NextRequest, NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { extractClickContext } from "@/lib/attribution";
import { fireCapi } from "@/lib/capi";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
