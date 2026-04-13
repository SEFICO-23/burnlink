import Link from "next/link";
import { serviceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = serviceClient();

  const { data: settings } = await sb
    .from("user_settings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!settings) notFound();

  // Get email
  const { data: authData } = await sb.auth.admin.getUserById(id);
  const email = authData?.user?.email ?? "—";

  // Get bots
  const { data: bots } = await sb
    .from("bots")
    .select("id, username, channel_id, telegram_id, is_active, last_refill_at, last_error")
    .eq("user_id", id)
    .order("created_at", { ascending: false });

  // Get counts
  const [clickCount, joinCount, capiCount] = await Promise.all([
    sb.from("clicks").select("id", { count: "exact", head: true }).eq("user_id", id),
    sb.from("joins").select("id", { count: "exact", head: true }).eq("user_id", id),
    sb.from("capi_events").select("id", { count: "exact", head: true }).eq("user_id", id),
  ]);

  // Pool health per bot
  const poolData: Array<{ bot: string; unused: number }> = [];
  for (const bot of bots ?? []) {
    const { count } = await sb
      .from("invite_links")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", bot.id)
      .eq("status", "unused");
    poolData.push({ bot: bot.username, unused: count ?? 0 });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="text-muted hover:text-text text-sm">&larr; Users</Link>
        <h1 className="text-xl font-semibold">{settings.display_name ?? email}</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Email</div>
          <div className="mt-2 text-sm">{email}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Slug</div>
          <div className="mt-2 font-mono text-sm">{settings.slug}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Pixel</div>
          <div className="mt-2 text-sm">{settings.fb_pixel_id ?? <span className="text-muted">not set</span>}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Joined</div>
          <div className="mt-2 text-sm">{new Date(settings.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Clicks</div>
          <div className="mt-2 text-2xl font-semibold">{clickCount.count ?? 0}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">Joins</div>
          <div className="mt-2 text-2xl font-semibold">{joinCount.count ?? 0}</div>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <div className="text-xs uppercase tracking-wide text-muted">CAPI Events</div>
          <div className="mt-2 text-2xl font-semibold">{capiCount.count ?? 0}</div>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Bots ({bots?.length ?? 0})</h2>
        <div className="bg-panel border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr className="text-left">
                <th className="p-3 font-medium">Bot</th>
                <th className="p-3 font-medium">Channel</th>
                <th className="p-3 font-medium">Unused Links</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Last Refill</th>
                <th className="p-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {(bots ?? []).map((b, i) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="p-3 font-mono text-xs">{b.username}</td>
                  <td className="p-3 font-mono text-xs">{b.channel_id ?? <span className="text-warn italic">pending</span>}</td>
                  <td className="p-3 text-xs">{poolData[i]?.unused ?? 0}</td>
                  <td className="p-3 text-xs">
                    <span className={b.is_active ? "text-ok" : "text-muted"}>
                      {b.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted">
                    {b.last_refill_at ? new Date(b.last_refill_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-xs text-err">{b.last_error ?? "—"}</td>
                </tr>
              ))}
              {(!bots || bots.length === 0) && (
                <tr><td colSpan={6} className="p-6 text-center text-muted">No bots</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
