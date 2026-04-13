// Pool refill helper used by both the cron and the "add bot" flow.

import { serviceClient } from "./supabase/server";
import { createManyInviteLinks } from "./telegram";
import { logOps } from "./ops";
import { sendOperatorAlert } from "./alerts";

export const POOL_TARGET = 1000;
export const POOL_FLOOR = 200;

interface Bot {
  id: string;
  username: string;
  token: string;
  channel_id: number | null;  // null = pending (no channel discovered yet)
  is_active: boolean;
}

export async function refillBot(bot: Bot, target = POOL_TARGET, floor = POOL_FLOOR) {
  if (!bot.channel_id) {
    return { created: 0, reason: "no_channel" as const };
  }
  const sb = serviceClient();
  const { count, error } = await sb
    .from("invite_links")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", bot.id)
    .eq("status", "unused");

  if (error) {
    await logOps("error", "refill", "count unused failed", {
      bot_id: bot.id,
      error: error.message,
    });
    return { created: 0, reason: "count_failed" as const };
  }

  const unused = count ?? 0;
  if (floor > 0 && unused >= floor) return { created: 0, reason: "above_floor" as const, unused };

  // Alert if pool is critically low (below 100)
  if (unused < 100 && bot.channel_id) {
    const { data: botOwner } = await sb
      .from("bots")
      .select("user_id")
      .eq("id", bot.id)
      .maybeSingle();

    if (botOwner?.user_id) {
      await sendOperatorAlert(
        botOwner.user_id,
        `Pool low: ${bot.username} #${bot.channel_id} has only ${unused} links left`,
        { bot_id: bot.id, unused },
      );
    }
  }

  const need = target - unused;
  const BATCH = 100;
  let totalCreated = 0;

  try {
    for (let offset = 0; offset < need; offset += BATCH) {
      const chunk = Math.min(BATCH, need - offset);
      const links = await createManyInviteLinks(bot.token, bot.channel_id, chunk);
      if (links.length === 0) break;

      const rows = links.map((l) => ({
        bot_id: bot.id,
        invite_link: l.invite_link,
        telegram_name: l.name,
        status: "unused" as const,
      }));

      const { error: insErr } = await sb.from("invite_links").insert(rows);
      if (insErr) {
        await logOps("error", "refill", "insert invite_links failed", {
          bot_id: bot.id,
          error: insErr.message,
          created_so_far: totalCreated,
        });
        break;
      }
      totalCreated += links.length;
    }

    await sb
      .from("bots")
      .update({ last_refill_at: new Date().toISOString(), last_error: null })
      .eq("id", bot.id);

    await logOps("info", "refill", "refilled", { bot_id: bot.id, created: totalCreated });
    return { created: totalCreated, reason: "ok" as const };
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from("bots").update({ last_error: msg }).eq("id", bot.id);
    await logOps("error", "refill", "telegram create failed", {
      bot_id: bot.id,
      error: msg,
      created_before_error: totalCreated,
    });
    return { created: totalCreated, reason: "tg_failed" as const };
  }
}

export async function refillAllActive() {
  const sb = serviceClient();
  const { data: bots, error } = await sb
    .from("bots")
    .select("id, username, token, channel_id, is_active")
    .eq("is_active", true);

  if (error || !bots) return [];

  const results: Array<{ bot_id: string; created: number; reason: string }> = [];
  for (const b of bots as Bot[]) {
    const r = await refillBot(b);
    results.push({ bot_id: b.id, created: r.created, reason: r.reason });
  }
  return results;
}

/** Seed a small initial batch on channel discovery (fits in Vercel 60s). */
export const SEED_BATCH = 200;

export async function seedInitialBatch(bot: Bot): Promise<{ created: number; reason: string }> {
  if (!bot.channel_id) return { created: 0, reason: "no_channel" };
  return refillBot(bot, SEED_BATCH, 0);
  // target=200, floor=0 → always creates up to 200 links
}
