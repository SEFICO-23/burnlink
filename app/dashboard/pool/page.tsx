import { serviceClient } from "@/lib/supabase/server";

interface Row {
  bot_id: string;
  username: string;
  is_active: boolean;
  unused: number;
  reserved: number;
  burned: number;
  last_refill_at: string | null;
  last_error: string | null;
}

export default async function PoolPage() {
  const sb = serviceClient();
  const { data } = await sb
    .from("pool_health_vw")
    .select("*")
    .order("username", { ascending: true });
  const rows = (data ?? []) as Row[];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pool health</h2>
      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr className="text-left">
              <th className="p-3 font-medium">Bot</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Unused</th>
              <th className="p-3 font-medium text-right">Reserved</th>
              <th className="p-3 font-medium text-right">Burned</th>
              <th className="p-3 font-medium">Last refill</th>
              <th className="p-3 font-medium">Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bot_id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{r.username}</td>
                <td className="p-3">
                  <span
                    className={
                      r.is_active ? "text-ok" : "text-muted"
                    }
                  >
                    {r.is_active ? "active" : "inactive"}
                  </span>
                </td>
                <td
                  className={`p-3 text-right ${
                    r.unused < 200 ? "text-warn" : ""
                  }`}
                >
                  {r.unused}
                </td>
                <td className="p-3 text-right">{r.reserved}</td>
                <td className="p-3 text-right">{r.burned}</td>
                <td className="p-3 text-xs text-muted">
                  {r.last_refill_at
                    ? new Date(r.last_refill_at).toLocaleString()
                    : "—"}
                </td>
                <td className="p-3 text-xs text-err">{r.last_error ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  No bots configured yet. Add one in the Bots tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
