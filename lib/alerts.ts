// Operator alerts — sends urgent notifications via Telegram DM
// and logs to ops_log for dashboard history.

import { serviceClient } from "./supabase/server";
import { tg } from "./telegram";
import { logOps } from "./ops";

export async function sendOperatorAlert(
  userId: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  // Always log to ops_log
  await logOps("warn", "alerts", message, { ...context, user_id: userId });

  const sb = serviceClient();

  const { data: settings } = await sb
    .from("user_settings")
    .select("telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();

  if (!settings?.telegram_chat_id) return;

  const { data: bot } = await sb
    .from("bots")
    .select("token")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!bot) return;

  try {
    await tg.sendMessage(bot.token, settings.telegram_chat_id, `Warning: ${message}`);
  } catch (e) {
    await logOps("error", "alerts", "Telegram alert delivery failed", {
      user_id: userId,
      error: (e as Error).message,
    });
  }
}
