import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAuth() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

// GET — list user's welcome messages
export async function GET() {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const sb = serviceClient();
  const { data, error } = await sb
    .from("welcome_messages")
    .select("id, bot_id, channel_id, message, is_active, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// POST — create or update a welcome message for a bot-channel pair
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    bot_id: string;
    channel_id: number;
    message: string;
    is_active?: boolean;
  } | null;

  if (!body?.bot_id || !body.channel_id || !body.message) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const sb = serviceClient();

  // Verify bot ownership
  const { data: bot } = await sb
    .from("bots")
    .select("user_id")
    .eq("id", body.bot_id)
    .maybeSingle();

  if (!bot || bot.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "not your bot" }, { status: 403 });
  }

  // Upsert (unique on bot_id + channel_id)
  const { data, error } = await sb
    .from("welcome_messages")
    .upsert(
      {
        user_id: user.id,
        bot_id: body.bot_id,
        channel_id: body.channel_id,
        message: body.message,
        is_active: body.is_active ?? true,
      },
      { onConflict: "bot_id,channel_id" },
    )
    .select("id, bot_id, channel_id, message, is_active")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// DELETE — remove a welcome message
export async function DELETE(req: NextRequest) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

  const sb = serviceClient();
  const { error } = await sb
    .from("welcome_messages")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
