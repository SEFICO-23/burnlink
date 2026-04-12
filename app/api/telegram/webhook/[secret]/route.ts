// Telegram webhook — receives `chat_member` updates when users join the channel.
// We reverse-lookup the invite link, match it to the reserved click, fire CAPI Lead.
//
// Auth: secret lives in the URL path segment (Telegram doesn't support custom headers).
// Also validates `X-Telegram-Bot-Api-Secret-Token` which setWebhook configured.

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { fireCapi } from "@/lib/capi";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TgChatMemberUpdate {
  update_id: number;
  chat_member?: {
    chat: { id: number; type: string; title?: string };
    from: { id: number; is_bot: boolean };
    date: number;
    old_chat_member: { user: { id: number }; status: string };
    new_chat_member: { user: { id: number }; status: string };
    invite_link?: {
      invite_link: string;
      name?: string;
      member_limit?: number;
      is_revoked?: boolean;
    };
  };
  my_chat_member?: unknown;
}

function isJoin(before: string, after: string) {
  const wasOut = before === "left" || before === "kicked";
  const isIn = after === "member" || after === "restricted";
  return wasOut && isIn;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ secret: string }> },
) {
  const { secret } = await ctx.params;
  if (secret !== process.env.TG_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret && headerSecret !== process.env.TG_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgChatMemberUpdate;
  try {
    update = (await req.json()) as TgChatMemberUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const cm = update.chat_member;
  if (!cm) {
    // my_chat_member or other — ignore
    return NextResponse.json({ ok: true });
  }

  if (!isJoin(cm.old_chat_member.status, cm.new_chat_member.status)) {
    return NextResponse.json({ ok: true });
  }

  const inviteStr = cm.invite_link?.invite_link;
  if (!inviteStr) {
    await logOps("warn", "webhook", "join without invite_link", {
      chat_id: cm.chat.id,
      user_id: cm.new_chat_member.user.id,
    });
    return NextResponse.json({ ok: true });
  }

  const sb = serviceClient();

  const { data: link } = await sb
    .from("invite_links")
    .select("id, status, reserved_click_id, bot_id")
    .eq("invite_link", inviteStr)
    .maybeSingle();

  if (!link) {
    await logOps("warn", "webhook", "unknown invite link", { inviteStr });
    return NextResponse.json({ ok: true });
  }

  // Idempotency — a retry from Telegram must not double-fire CAPI
  if (link.status === "burned") {
    return NextResponse.json({ ok: true });
  }

  const { data: click } = link.reserved_click_id
    ? await sb
        .from("clicks")
        .select(
          "id, event_id, fbclid, fbc, fbp, ip, user_agent, country, utm_campaign, utm_source, utm_content",
        )
        .eq("id", link.reserved_click_id)
        .maybeSingle()
    : { data: null };

  const { data: joinRow, error: joinErr } = await sb
    .from("joins")
    .insert({
      click_id: click?.id ?? null,
      invite_link_id: link.id,
      telegram_user_id: cm.new_chat_member.user.id,
    })
    .select("id, event_id")
    .single();

  if (joinErr || !joinRow) {
    await logOps("error", "webhook", "join insert failed", { error: joinErr?.message });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  await sb
    .from("invite_links")
    .update({ status: "burned", burned_at: new Date().toISOString() })
    .eq("id", link.id);

  // Fire CAPI Lead — blocking this request is fine, Telegram has a generous timeout
  try {
    const result = await fireCapi({
      kind: "Lead",
      event_id: joinRow.event_id,
      event_source_url: process.env.APP_URL ?? "https://burnlink.local",
      action_source: "chat",
      user_data: {
        fbclid: click?.fbclid ?? null,
        fbc: click?.fbc ?? null,
        fbp: click?.fbp ?? null,
        client_ip_address: click?.ip ?? null,
        client_user_agent: click?.user_agent ?? null,
        country: click?.country ?? null,
      },
    });
    await sb.from("capi_events").insert({
      kind: "Lead",
      click_id: click?.id ?? null,
      join_id: joinRow.id,
      event_id: joinRow.event_id,
      request_body: result.request as object,
      response: result.body as object,
      http_status: result.status,
    });
  } catch (e) {
    await logOps("error", "capi", "Lead fire failed", {
      join_id: joinRow.id,
      error: (e as Error).message,
    });
  }

  return NextResponse.json({ ok: true });
}
