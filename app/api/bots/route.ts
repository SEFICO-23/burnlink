// POST  /api/bots  — operator adds a bot (token-only). Registers webhook for auto-discovery.
// DELETE /api/bots?id=<uuid> — deactivate a bot (soft).
//
// Auth: uses the operator's Supabase session cookie. Must be the configured OPERATOR_EMAIL.

import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";
import { tg } from "@/lib/telegram";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOperator() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user || data.user.email !== process.env.OPERATOR_EMAIL) {
    return null;
  }
  return data.user;
}

export async function POST(req: NextRequest) {
  const user = await requireOperator();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) {
    return NextResponse.json(
      { ok: false, error: "token required" },
      { status: 400 },
    );
  }

  try {
    const me = await tg.getMe(body.token);

    const sb = serviceClient();

    // Check if this bot (by telegram_id) already has a pending row
    const { data: existing } = await sb
      .from("bots")
      .select("id")
      .eq("telegram_id", me.id)
      .is("channel_id", null)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { ok: false, error: "This bot is already registered and waiting for a channel. Add it as admin to a Telegram channel." },
        { status: 409 },
      );
    }

    const { data: bot, error } = await sb
      .from("bots")
      .insert({
        username: me.username ?? me.first_name,
        token: body.token,
        telegram_id: me.id,
        channel_id: null,
        is_active: true,
      })
      .select("id, username, telegram_id, channel_id, is_active")
      .single();

    if (error || !bot) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "insert failed" },
        { status: 500 },
      );
    }

    // Register webhook so Telegram sends my_chat_member when bot is added to channels
    const webhookUrl = `${process.env.APP_URL}/api/telegram/webhook/${process.env.TG_WEBHOOK_SECRET}`;
    await tg.setWebhook(body.token, webhookUrl, process.env.TG_WEBHOOK_SECRET);

    await logOps("info", "bots", "bot added, webhook registered, waiting for channel", {
      bot_id: bot.id,
      username: bot.username,
      telegram_id: me.id,
    });

    return NextResponse.json({ ok: true, bot });
  } catch (e) {
    const msg = (e as Error).message;
    await logOps("error", "bots", "add bot failed", { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireOperator();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });

  const sb = serviceClient();
  const { error } = await sb.from("bots").update({ is_active: false }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
