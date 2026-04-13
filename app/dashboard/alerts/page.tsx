import { serviceClient, rscClient } from "@/lib/supabase/server";

export default async function AlertsPage() {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const svc = serviceClient();
  const { data: logs } = await svc
    .from("ops_log")
    .select("id, level, source, message, context, at")
    .eq("user_id", auth.user.id)
    .in("level", ["warn", "error"])
    .order("at", { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Alerts</h1>
      {!logs || logs.length === 0 ? (
        <p className="text-sm text-muted">No alerts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Level</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted">
                    {new Date(l.at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        l.level === "error"
                          ? "text-red-400 font-medium"
                          : "text-yellow-400"
                      }
                    >
                      {l.level}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted">{l.source}</td>
                  <td className="py-2">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
