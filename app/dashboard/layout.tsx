import Link from "next/link";
import { rscClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const tabs = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/funnel", label: "Funnel" },
  { href: "/dashboard/pool", label: "Pool" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/bots", label: "Bots" },
] as const;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (!data.user || data.user.email !== process.env.OPERATOR_EMAIL) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-8">
          <div className="font-semibold text-lg">burnlink</div>
          <nav className="flex gap-4 text-sm">
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
          <div className="ml-auto text-xs text-muted">{data.user.email}</div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
