import { serviceClient, rscClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("slug, display_name, fb_pixel_id, fb_capi_token, fb_test_code, affiliate_url")
    .eq("id", auth.user.id)
    .single();

  return <SettingsClient initial={settings} />;
}
