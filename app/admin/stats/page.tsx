import { serviceClient } from "@/lib/supabase/server";

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function AdminStatsPage() {
  const sb = serviceClient();

  const [users, bots, clicks, joins, capiOk, capiFail, linksUnused] = await Promise.all([
    sb.from("user_settings").select("id", { count: "exact", head: true }),
    sb.from("bots").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("clicks").select("id", { count: "exact", head: true }),
    sb.from("joins").select("id", { count: "exact", head: true }),
    sb.from("capi_events").select("id", { count: "exact", head: true }).eq("http_status", 200),
    sb.from("capi_events").select("id", { count: "exact", head: true }).neq("http_status", 200),
    sb.from("invite_links").select("id", { count: "exact", head: true }).eq("status", "unused"),
  ]);

  const totalCapi = (capiOk.count ?? 0) + (capiFail.count ?? 0);
  const capiRate = totalCapi > 0
    ? `${Math.round(((capiOk.count ?? 0) / totalCapi) * 100)}%`
    : "—";

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Global Stats</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Users" value={users.count ?? 0} />
        <Card label="Active Bots" value={bots.count ?? 0} />
        <Card label="Total Clicks" value={clicks.count ?? 0} />
        <Card label="Total Joins" value={joins.count ?? 0} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          label="Join Rate"
          value={
            (clicks.count ?? 0) > 0
              ? `${(((joins.count ?? 0) / (clicks.count ?? 1)) * 100).toFixed(1)}%`
              : "—"
          }
        />
        <Card label="CAPI Success Rate" value={capiRate} hint={`${capiOk.count ?? 0} / ${totalCapi}`} />
        <Card label="Unused Links" value={linksUnused.count ?? 0} />
        <Card label="—" value="" />
      </div>
    </div>
  );
}
