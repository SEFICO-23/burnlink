import { serviceClient } from "@/lib/supabase/server";

interface Row {
  key: string;
  clicks: number;
  reserved: number;
  burned: number;
  leads: number;
}

async function funnelBy(column: "utm_campaign" | "utm_source" | "utm_content") {
  const sb = serviceClient();

  const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
  const { data: clicks } = await sb
    .from("clicks")
    .select(`id, ${column}, assigned_link_id`)
    .gte("received_at", since);

  const { data: joins } = await sb
    .from("joins")
    .select("click_id")
    .gte("joined_at", since);

  const { data: leads } = await sb
    .from("capi_events")
    .select("click_id, join_id")
    .eq("kind", "Lead")
    .eq("http_status", 200)
    .gte("fired_at", since);

  const joinClickIds = new Set((joins ?? []).map((j) => j.click_id));
  const leadClickIds = new Set((leads ?? []).map((l) => l.click_id));

  const rows = new Map<string, Row>();
  for (const c of (clicks ?? []) as Array<{
    id: string;
    assigned_link_id: string | null;
    [key: string]: unknown;
  }>) {
    const key = (c[column] as string | null) ?? "(none)";
    const r = rows.get(key) ?? { key, clicks: 0, reserved: 0, burned: 0, leads: 0 };
    r.clicks++;
    if (c.assigned_link_id) r.reserved++;
    if (joinClickIds.has(c.id)) r.burned++;
    if (leadClickIds.has(c.id)) r.leads++;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.clicks - a.clicks);
}

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const params = await searchParams;
  const by = (params.by as "utm_campaign" | "utm_source" | "utm_content") ?? "utm_campaign";
  const rows = await funnelBy(by);

  const tabs: Array<{ key: typeof by; label: string }> = [
    { key: "utm_campaign", label: "Campaign" },
    { key: "utm_source", label: "Source" },
    { key: "utm_content", label: "Ad" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Funnel — last 30 days</h2>
        <div className="ml-auto flex gap-2 text-xs">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/dashboard/funnel?by=${t.key}`}
              className={`px-3 py-1.5 rounded border ${
                by === t.key
                  ? "border-accent text-accent"
                  : "border-border text-muted hover:text-text"
              }`}
            >
              {t.label}
            </a>
          ))}
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr className="text-left">
              <th className="p-3 font-medium">{by.replace("utm_", "")}</th>
              <th className="p-3 font-medium text-right">Clicks</th>
              <th className="p-3 font-medium text-right">Reserved</th>
              <th className="p-3 font-medium text-right">Joined</th>
              <th className="p-3 font-medium text-right">Leads fired</th>
              <th className="p-3 font-medium text-right">Join %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{r.key}</td>
                <td className="p-3 text-right">{r.clicks}</td>
                <td className="p-3 text-right">{r.reserved}</td>
                <td className="p-3 text-right">{r.burned}</td>
                <td className="p-3 text-right">{r.leads}</td>
                <td className="p-3 text-right">
                  {r.clicks ? `${((r.burned / r.clicks) * 100).toFixed(1)}%` : "–"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  No clicks in the last 30 days yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
