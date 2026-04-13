// Telegram webhook — receives two update types:
//   `chat_member`    — user joins channel → reverse-lookup invite link, fire CAPI Lead
//   `my_chat_member` — bot added/removed as channel admin → auto-discover/deactivate
//
// Auth: secret lives in the URL path segment (Telegram doesn't support custom headers).
// Also validates `X-Telegram-Bot-Api-Secret-Token` which setWebhook configured.

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { fireCapi } from "@/lib/capi";
import { seedInitialBatch } from "@/lib/pool";
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
  my_chat_member?: TgMyChatMemberUpdate;
}

interface TgMyChatMemberUpdate {
  chat: { id: number; type: string; title?: string };
  from: { id: number; is_bot: boolean };
  date: number;
  old_chat_member: { user: { id: number; username?: string }; status: string };
  new_chat_member: { user: { id: number; username?: string }; status: string };
}

function isJoin(before: string, after: string) {
  const wasOut = before === "left" || before === "kicked";
  const isIn = after === "member" || after === "restricted";
  return wasOut && isIn;
}

async function handleMyChatMember(mcm: TgMyChatMemberUpdate): Promise<void> {
  const botTgId = mcm.new_chat_member.user.id;
  const chatId = mcm.chat.id;
  const newStatus = mcm.new_chat_member.status;
  const chatType = mcm.chat.type;

  // Only care about channels and supergroups
  if (chatType !== "channel" && chatType !== "supergroup") return;

  const sb = serviceClient();

  if (newStatus === "administrator") {
    // Bot was promoted to admin — auto-discover this channel

    // Find the bot by telegram_id
    const { data: parentBot } = await sb
      .from("bots")
      .select("id, username, token, telegram_id, channel_id, is_active")
      .eq("telegram_id", botTgId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!parentBot) {
      await logOps("warn", "webhook", "my_chat_member for unknown bot", {
        bot_tg_id: botTgId,
        chat_id: chatId,
      });
      return;
    }

    // Check if this bot-channel pair already exists
    const { data: existingPair } = await sb
      .from("bots")
      .select("id")
      .eq("telegram_id", botTgId)
      .eq("channel_id", chatId)
      .maybeSingle();

    if (existingPair) {
      // Already known — reactivate if needed
      await sb.from("bots").update({ is_active: true }).eq("id", existingPair.id);
      await logOps("info", "webhook", "bot-channel pair already exists, reactivated", {
        bot_id: existingPair.id,
        chat_id: chatId,
      });
      return;
    }

    let botRowId: string;

    if (parentBot.channel_id === null) {
      // First channel for this bot — update the pending row
      const { error } = await sb
        .from("bots")
        .update({ channel_id: chatId })
        .eq("id", parentBot.id);

      if (error) {
        await logOps("error", "webhook", "failed to set channel_id on pending bot", {
          bot_id: parentBot.id,
          chat_id: chatId,
          error: error.message,
        });
        return;
      }
      botRowId = parentBot.id;
    } else {
      // Bot already has a channel — create a new row for this additional channel
      const { data: newRow, error } = await sb
        .from("bots")
        .insert({
          username: parentBot.username,
          token: parentBot.token,
          telegram_id: parentBot.telegram_id,
          channel_id: chatId,
          is_active: true,
        })
        .select("id")
        .single();

      if (error || !newRow) {
        await logOps("error", "webhook", "failed to insert bot-channel pair", {
          telegram_id: botTgId,
          chat_id: chatId,
          error: error?.message,
        });
        return;
      }
      botRowId = newRow.id;
    }

    await logOps("info", "webhook", "channel auto-discovered", {
      bot_id: botRowId,
      chat_id: chatId,
      chat_title: mcm.chat.title,
    });

    // Seed initial batch (200 links — fits in Vercel 60s)
    const bot = {
      id: botRowId,
      username: parentBot.username,
      token: parentBot.token,
      channel_id: chatId,
      is_active: true,
    };
    const result = await seedInitialBatch(bot);
    await logOps("info", "webhook", "initial seed complete", {
      bot_id: botRowId,
      chat_id: chatId,
      created: result.created,
      reason: result.reason,
    });

  } else if (newStatus === "left" || newStatus === "kicked") {
    // Bot was removed from channel — deactivate the pair
    const { data: pair } = await sb
      .from("bots")
      .select("id")
      .eq("telegram_id", botTgId)
      .eq("channel_id", chatId)
      .maybeSingle();

    if (pair) {
      await sb.from("bots").update({ is_active: false }).eq("id", pair.id);
      await logOps("info", "webhook", "bot removed from channel, deactivated", {
        bot_id: pair.id,
        chat_id: chatId,
      });
    }
  }
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

  if (update.my_chat_member) {
    try {
      await handleMyChatMember(update.my_chat_member);
    } catch (e) {
      await logOps("error", "webhook", "my_chat_member handler failed", {
        error: (e as Error).message,
      });
    }
    return NextResponse.json({ ok: true });
  }

  const cm = update.chat_member;
  if (!cm) {
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
