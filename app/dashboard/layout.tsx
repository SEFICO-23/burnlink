import Link from "next/link";
import { rscClient, serviceClient } from "@/lib/supabase/server";
import ThemeToggle from "@/lib/components/ThemeToggle";
import { redirect } from "next/navigation";

const tabs = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/funnel", label: "Funnel" },
  { href: "/dashboard/pool", label: "Pool" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/bots", label: "Bots" },
  { href: "/dashboard/messages", label: "Messages" },
  { href: "/dashboard/alerts", label: "Alerts" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    redirect("/login");
  }

  // Check onboarding complete
  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("id, is_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!settings) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-4 md:gap-8">
          <div className="font-semibold text-lg">burnlink</div>
          <nav className="flex gap-4 text-sm overflow-x-auto whitespace-nowrap">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href as any}
                className="text-muted hover:text-text transition"
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            {settings?.is_admin && (
              <Link href="/admin" className="text-accent hover:underline">
                Admin
              </Link>
            )}
            <span>{data.user.email}</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
