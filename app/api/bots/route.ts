// POST  /api/bots  — operator adds a bot. Validates token + channel, seeds pool.
// DELETE /api/bots?id=<uuid> — deactivate a bot (soft).
//
// Auth: uses the operator's Supabase session cookie. Must be the configured OPERATOR_EMAIL.

import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";
import { tg } from "@/lib/telegram";
import { refillBot } from "@/lib/pool";
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

  const body = (await req.json().catch(() => null)) as
    | { token?: string; channel_id?: number }
    | null;
  if (!body?.token || !body?.channel_id) {
    return NextResponse.json(
      { ok: false, error: "token and channel_id required" },
      { status: 400 },
    );
  }

  try {
    const me = await tg.getMe(body.token);
    const chat = await tg.getChat(body.token, body.channel_id);

    const sb = serviceClient();
    const { data: bot, error } = await sb
      .from("bots")
      .insert({
        username: me.username ?? me.first_name,
        token: body.token,
        channel_id: chat.id,
        is_active: true,
      })
      .select("id, username, token, channel_id, is_active")
      .single();

    if (error || !bot) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "insert failed" },
        { status: 500 },
      );
    }

    // Kick off initial seed inline (1000 links).
    // This will take ~10s at concurrency 5 and 50ms stagger.
    const result = await refillBot(bot);
    return NextResponse.json({ ok: true, bot, refill: result });
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
