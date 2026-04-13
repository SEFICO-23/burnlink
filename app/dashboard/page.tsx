import { rscClient } from "@/lib/supabase/server";
import ChartSection from "./ChartSection";

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

async function countSince(table: string, since: string) {
  const sb = await rscClient();
  const { count } = await sb
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(
      table === "clicks" ? "received_at" : table === "joins" ? "joined_at" : "fired_at",
      since,
    );
  return count ?? 0;
}

async function capiSuccessSince(since: string) {
  const sb = await rscClient();
  const { count: total } = await sb
    .from("capi_events")
    .select("id", { count: "exact", head: true })
    .gte("fired_at", since);
  const { count: ok } = await sb
    .from("capi_events")
    .select("id", { count: "exact", head: true })
    .gte("fired_at", since)
    .eq("http_status", 200);
  if (!total) return { total: 0, ok: 0, rate: "–" };
  return { total, ok: ok ?? 0, rate: `${Math.round(((ok ?? 0) / total) * 100)}%` };
}

async function dailyCounts(days: number) {
  const sb = await rscClient();
  const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();

  const { data: clicks } = await sb
    .from("clicks")
    .select("received_at")
    .gte("received_at", since);

  const { data: joins } = await sb
    .from("joins")
    .select("joined_at")
    .gte("joined_at", since);

  const map = new Map<string, { clicks: number; joins: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 24 * 3600e3);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { clicks: 0, joins: 0 });
  }

  for (const c of clicks ?? []) {
    const key = new Date(c.received_at).toISOString().slice(0, 10);
    const entry = map.get(key);
    if (entry) entry.clicks++;
  }

  for (const j of joins ?? []) {
    const key = new Date(j.joined_at).toISOString().slice(0, 10);
    const entry = map.get(key);
    if (entry) entry.joins++;
  }

  return [...map.entries()].map(([day, v]) => ({ day, ...v }));
}

export default async function Overview() {
  const now = new Date();
  const d1 = new Date(now.getTime() - 24 * 3600e3).toISOString();
  const d7 = new Date(now.getTime() - 7 * 24 * 3600e3).toISOString();
  const d30 = new Date(now.getTime() - 30 * 24 * 3600e3).toISOString();

  const [c1, c7, c30, j1, j7, j30, capi1, daily] = await Promise.all([
    countSince("clicks", d1),
    countSince("clicks", d7),
    countSince("clicks", d30),
    countSince("joins", d1),
    countSince("joins", d7),
    countSince("joins", d30),
    capiSuccessSince(d1),
    dailyCounts(30),
  ]);

  const rate = (j: number, c: number) => (c ? `${((j / c) * 100).toFixed(1)}%` : "–");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Last 24h</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Clicks" value={c1} />
          <Card label="Joins" value={j1} />
          <Card label="Join rate" value={rate(j1, c1)} />
          <Card
            label="CAPI success"
            value={capi1.rate}
            hint={`${capi1.ok} / ${capi1.total}`}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Last 7 days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Clicks" value={c7} />
          <Card label="Joins" value={j7} />
          <Card label="Join rate" value={rate(j7, c7)} />
          <Card label="—" value="" />
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Last 30 days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Clicks" value={c30} />
          <Card label="Joins" value={j30} />
          <Card label="Join rate" value={rate(j30, c30)} />
          <Card label="—" value="" />
        </div>
      </section>

      <ChartSection data={daily} />
    </div>
  );
}
