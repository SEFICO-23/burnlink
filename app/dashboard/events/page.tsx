import { serviceClient } from "@/lib/supabase/server";

interface CapiRow {
  id: string;
  kind: string;
  http_status: number | null;
  fired_at: string;
  event_id: string;
}

interface OpsRow {
  id: number;
  level: string;
  source: string;
  message: string;
  at: string;
}

export default async function EventsPage() {
  const sb = serviceClient();
  const { data: capi } = await sb
    .from("capi_events")
    .select("id, kind, http_status, fired_at, event_id")
    .order("fired_at", { ascending: false })
    .limit(50);
  const { data: ops } = await sb
    .from("ops_log")
    .select("id, level, source, message, at")
    .order("at", { ascending: false })
    .limit(50);

  const capiRows = (capi ?? []) as CapiRow[];
  const opsRows = (ops ?? []) as OpsRow[];

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-3">
          Recent CAPI events
        </h2>
        <div className="bg-panel border border-border rounded-xl overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-bg border-b border-border">
              <tr className="text-left">
                <th className="p-2">When</th>
                <th className="p-2">Kind</th>
                <th className="p-2">HTTP</th>
                <th className="p-2">Event ID</th>
              </tr>
            </thead>
            <tbody>
              {capiRows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 text-muted">
                    {new Date(r.fired_at).toLocaleTimeString()}
                  </td>
                  <td className="p-2">{r.kind}</td>
                  <td
                    className={`p-2 font-mono ${
                      r.http_status === 200 ? "text-ok" : "text-err"
                    }`}
                  >
                    {r.http_status ?? "—"}
                  </td>
                  <td className="p-2 font-mono text-muted">{r.event_id.slice(0, 8)}</td>
                </tr>
              ))}
              {capiRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted">
                    No CAPI events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-3">
          Recent ops log
        </h2>
        <div className="bg-panel border border-border rounded-xl overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-bg border-b border-border">
              <tr className="text-left">
                <th className="p-2">When</th>
                <th className="p-2">Level</th>
                <th className="p-2">Source</th>
                <th className="p-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {opsRows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 text-muted">
                    {new Date(r.at).toLocaleTimeString()}
                  </td>
                  <td
                    className={`p-2 ${
                      r.level === "error"
                        ? "text-err"
                        : r.level === "warn"
                          ? "text-warn"
                          : "text-muted"
                    }`}
                  >
                    {r.level}
                  </td>
                  <td className="p-2">{r.source}</td>
                  <td className="p-2">{r.message}</td>
                </tr>
              ))}
              {opsRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted">
                    No log entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
