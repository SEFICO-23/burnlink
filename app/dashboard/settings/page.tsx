import { serviceClient, rscClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();
  const [{ data: settings }, { data: bots }] = await Promise.all([
    svc
      .from("user_settings")
      .select("slug, display_name, fb_pixel_id, fb_capi_token, fb_test_code, affiliate_url, telegram_chat_id")
      .eq("id", auth.user.id)
      .single(),
    svc
      .from("bots")
      .select("id, username")
      .eq("user_id", auth.user.id)
      .eq("is_active", true),
  ]);

  return <SettingsClient initial={settings} bots={bots ?? []} userId={auth.user.id} />;
}
