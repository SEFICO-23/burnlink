import { serviceClient } from "@/lib/supabase/server";
import BotsClient from "./BotsClient";

export default async function BotsPage() {
  const sb = serviceClient();
  const { data } = await sb
    .from("bots")
    .select("id, username, channel_id, is_active, last_refill_at, last_error, created_at")
    .order("created_at", { ascending: false });

  return <BotsClient initial={data ?? []} />;
}
