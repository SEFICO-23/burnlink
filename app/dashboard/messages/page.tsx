import { serviceClient, rscClient } from "@/lib/supabase/server";
import MessagesClient from "./MessagesClient";

export default async function MessagesPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();

  const [{ data: messages }, { data: bots }] = await Promise.all([
    svc
      .from("welcome_messages")
      .select("id, bot_id, channel_id, message, is_active")
      .eq("user_id", auth.user.id),
    svc
      .from("bots")
      .select("id, username, channel_id")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .not("channel_id", "is", null),
  ]);

  return (
    <MessagesClient
      initial={messages ?? []}
      bots={bots ?? []}
    />
  );
}
