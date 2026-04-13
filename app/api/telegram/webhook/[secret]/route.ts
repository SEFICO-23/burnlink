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
import { tg } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TgMessageUpdate {
  message_id: number;
  from: { id: number; is_bot: boolean; username?: string; first_name?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
}

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
  message?: TgMessageUpdate;
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
      .select("id, username, token, telegram_id, channel_id, is_active, user_id")
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
          user_id: parentBot.user_id,
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

async function handleStats(
  msg: TgMessageUpdate,
  sb: ReturnType<typeof serviceClient>,
): Promise<void> {
  const chatId = msg.chat.id;

  const { data: settings } = await sb
    .from("user_settings")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (!settings) {
    await logOps("info", "webhook", "/stats from unlinked chat", { chatId });
    return;
  }

  const userId = settings.id;
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: clicks24h },
    { count: clicks7d },
    { count: joins24h },
    { count: joins7d },
    { count: capiTotal },
    { count: capiOk },
    { data: pools },
  ] = await Promise.all([
    sb.from("clicks").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("received_at", h24),
    sb.from("clicks").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("received_at", d7),
    sb.from("joins").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("joined_at", h24),
    sb.from("joins").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("joined_at", d7),
    sb.from("capi_events").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("fired_at", h24),
    sb.from("capi_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("http_status", 200).gte("fired_at", h24),
    sb.from("pool_health_vw").select("username, channel_id, unused, burned").eq("user_id", userId).eq("is_active", true),
  ]);

  const rate24 = capiTotal && capiTotal > 0
    ? Math.round(((capiOk ?? 0) / capiTotal) * 100)
    : 0;

  const joinRate24 = clicks24h && clicks24h > 0
    ? ((joins24h ?? 0) / clicks24h * 100).toFixed(1)
    : "0";

  let text = `burnlink stats\n\n`;
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

async function handleMessage(msg: TgMessageUpdate): Promise<void> {
  const text = msg.text?.trim() ?? "";
  const chatId = msg.chat.id;

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
        "Alerts enabled! You'll receive pool and CAPI notifications here.",
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

  // Look up the bot's owner + token (token reused for welcome DM)
  const { data: botRow } = await sb
    .from("bots")
    .select("user_id, token")
    .eq("id", link.bot_id)
    .maybeSingle();

  const { data: owner } = botRow?.user_id
    ? await sb
        .from("user_settings")
        .select("id, fb_pixel_id, fb_capi_token, fb_test_code, slug, affiliate_url")
        .eq("id", botRow.user_id)
        .maybeSingle()
    : { data: null };

  const { data: joinRow, error: joinErr } = await sb
    .from("joins")
    .insert({
      click_id: click?.id ?? null,
      invite_link_id: link.id,
      telegram_user_id: cm.new_chat_member.user.id,
      user_id: botRow?.user_id ?? null,
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

  // Fire CAPI Lead with bot owner's credentials
  const creds = owner?.fb_pixel_id && owner?.fb_capi_token
    ? { pixel_id: owner.fb_pixel_id, access_token: owner.fb_capi_token, test_event_code: owner.fb_test_code }
    : undefined;

  if (!creds) {
    await logOps("warn", "capi", "Lead skipped — bot owner has no FB credentials", {
      join_id: joinRow.id,
      user_id: botRow?.user_id,
    });
  } else {
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
      }, creds);
      await sb.from("capi_events").insert({
        kind: "Lead",
        click_id: click?.id ?? null,
        join_id: joinRow.id,
        user_id: botRow?.user_id ?? null,
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
  }

  // Send welcome DM with /out link
  try {
    const { data: wm } = await sb
      .from("welcome_messages")
      .select("message")
      .eq("bot_id", link.bot_id)
      .eq("channel_id", cm.chat.id)
      .eq("is_active", true)
      .maybeSingle();

    if (wm && owner?.affiliate_url && botRow?.token) {
      const outLink = `${process.env.APP_URL}/out?uid=${owner.slug}&jid=${joinRow.id}`;
      const text = wm.message.replaceAll("{out_link}", outLink);

      await tg.sendMessage(botRow.token, cm.new_chat_member.user.id, text);
    }
  } catch (e) {
    // Welcome DM failure must not break the join flow
    await logOps("warn", "webhook", "welcome DM failed", {
      join_id: joinRow.id,
      telegram_user_id: cm.new_chat_member.user.id,
      error: (e as Error).message,
    });
  }

  return NextResponse.json({ ok: true });
}
