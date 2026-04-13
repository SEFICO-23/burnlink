import Link from "next/link";
import { rscClient, serviceClient } from "@/lib/supabase/server";
import ThemeToggle from "@/lib/components/ThemeToggle";
import { notFound, redirect } from "next/navigation";

const tabs = [
  { href: "/admin", label: "Users" },
  { href: "/admin/stats", label: "Global Stats" },
  { href: "/admin/ops", label: "Ops Log" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("is_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  // Non-admins get 404 (don't reveal the route exists)
  if (!settings?.is_admin) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-4 md:gap-8">
          <Link href="/admin" className="font-semibold text-lg">
            burnlink <span className="text-accent text-sm font-normal ml-1">admin</span>
          </Link>
          <nav className="flex gap-4 text-sm overflow-x-auto whitespace-nowrap">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="text-muted hover:text-text transition"
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            <Link href="/dashboard" className="hover:text-text transition">
              My Dashboard
            </Link>
            <span>{data.user.email}</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
