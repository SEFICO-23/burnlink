// The attribution bridge.
//
// FB ad → /go?fbclid=...&utm_* → this handler →
//   1) capture click row (with all ad params, IP, UA, country)
//   2) atomically pop one unused burn invite link via pop_unused_link()
//   3) link click.assigned_link_id to that link
//   4) fire-and-forget CAPI PageView (after response)
//   5) 302 to the Telegram invite link
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

  const { data: click, error: clickErr } = await sb
    .from("clicks")
    .insert({
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
    await logOps("error", "go", "click insert failed", { error: clickErr?.message });
    return NextResponse.redirect(new URL("/sold-out", req.url), 302);
  }

  // Atomic burn-link reservation
  const { data: popped, error: popErr } = await sb.rpc("pop_unused_link", {
    p_click_id: click.id,
  });

  if (popErr) {
    await logOps("error", "go", "pop_unused_link rpc failed", {
      click_id: click.id,
      error: popErr.message,
    });
    return NextResponse.redirect(new URL("/sold-out", req.url), 302);
  }

  const row = Array.isArray(popped) ? popped[0] : popped;
  if (!row?.invite_link) {
    await logOps("warn", "go", "pool empty", { click_id: click.id });
    return NextResponse.redirect(new URL("/sold-out", req.url), 302);
  }

  // Link click row to reserved invite link
  await sb
    .from("clicks")
    .update({ assigned_link_id: row.link_id })
    .eq("id", click.id);

  // Fire-and-forget CAPI PageView after the redirect response is queued
  after(async () => {
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
      });
      await sb.from("capi_events").insert({
        kind: "PageView",
        click_id: click.id,
        event_id: click.event_id,
        request_body: result.request as object,
        response: result.body as object,
        http_status: result.status,
      });
    } catch (e) {
      await logOps("error", "capi", "PageView fire failed", {
        click_id: click.id,
        error: (e as Error).message,
      });
    }
  });

  return NextResponse.redirect(row.invite_link, 302);
}
