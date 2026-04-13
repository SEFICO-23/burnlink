import { serviceClient } from "@/lib/supabase/server";

export default async function AdminOpsPage() {
  const sb = serviceClient();

  const { data: logs } = await sb
    .from("ops_log")
    .select("id, level, source, message, context, at, user_id")
    .order("at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Ops Log (last 100)</h1>
      <div className="bg-panel border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr className="text-left">
              <th className="p-2 md:p-3 font-medium">Time</th>
              <th className="p-2 md:p-3 font-medium">Level</th>
              <th className="p-2 md:p-3 font-medium">Source</th>
              <th className="p-2 md:p-3 font-medium">Message</th>
              <th className="p-2 md:p-3 font-medium">Context</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-2 md:p-3 text-xs text-muted whitespace-nowrap">
                  {new Date(r.at).toLocaleString()}
                </td>
                <td className="p-2 md:p-3 text-xs">
                  <span
                    className={
                      r.level === "error"
                        ? "text-err"
                        : r.level === "warn"
                          ? "text-warn"
                          : "text-muted"
                    }
                  >
                    {r.level}
                  </span>
                </td>
                <td className="p-2 md:p-3 text-xs font-mono">{r.source}</td>
                <td className="p-2 md:p-3 text-xs">{r.message}</td>
                <td className="p-2 md:p-3 text-xs font-mono text-muted max-w-xs truncate">
                  {r.context ? JSON.stringify(r.context) : "—"}
                </td>
              </tr>
            ))}
            {(!logs || logs.length === 0) && (
              <tr><td colSpan={5} className="p-6 text-center text-muted">No entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
