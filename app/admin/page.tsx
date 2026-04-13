import Link from "next/link";
import { serviceClient } from "@/lib/supabase/server";

export default async function AdminUsersPage() {
  const sb = serviceClient();

  const { data: users } = await sb
    .from("user_settings")
    .select("id, display_name, slug, is_admin, created_at, fb_pixel_id")
    .order("created_at", { ascending: false });

  // Get bot counts per user
  const { data: botCounts } = await sb
    .from("bots")
    .select("user_id")
    .eq("is_active", true);

  const botCountMap = new Map<string, number>();
  for (const b of botCounts ?? []) {
    botCountMap.set(b.user_id, (botCountMap.get(b.user_id) ?? 0) + 1);
  }

  // Get user emails from auth (service client can query auth.users via admin API)
  const { data: authData } = await sb.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  for (const u of authData?.users ?? []) {
    emailMap.set(u.id, u.email ?? "—");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users ({users?.length ?? 0})</h1>
      <div className="bg-panel border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr className="text-left">
              <th className="p-2 md:p-3 font-medium">Email</th>
              <th className="p-2 md:p-3 font-medium">Name</th>
              <th className="p-2 md:p-3 font-medium">Slug</th>
              <th className="p-2 md:p-3 font-medium">Bots</th>
              <th className="p-2 md:p-3 font-medium">Pixel</th>
              <th className="p-2 md:p-3 font-medium">Admin</th>
              <th className="p-2 md:p-3 font-medium">Joined</th>
              <th className="p-2 md:p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-2 md:p-3 text-xs">{emailMap.get(u.id) ?? "—"}</td>
                <td className="p-2 md:p-3 text-xs">{u.display_name ?? "—"}</td>
                <td className="p-2 md:p-3 font-mono text-xs">{u.slug}</td>
                <td className="p-2 md:p-3 text-xs">{botCountMap.get(u.id) ?? 0}</td>
                <td className="p-2 md:p-3 text-xs">
                  {u.fb_pixel_id ? (
                    <span className="text-ok">configured</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="p-2 md:p-3 text-xs">
                  {u.is_admin ? <span className="text-accent">admin</span> : "—"}
                </td>
                <td className="p-2 md:p-3 text-xs text-muted">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="p-2 md:p-3 text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    view
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
