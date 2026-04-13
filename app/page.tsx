import Link from "next/link";
import { rscClient } from "@/lib/supabase/server";
import ThemeToggle from "@/lib/components/ThemeToggle";

export default async function LandingPage() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  const isAuthed = !!data.user;

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-semibold text-lg">burnlink</div>
          <div className="flex items-center gap-4 text-sm">
            {isAuthed ? (
              <Link href="/dashboard" className="bg-accent text-black font-medium rounded px-4 py-2">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-muted hover:text-text transition">
                  Sign in
                </Link>
                <Link href="/login" className="bg-accent text-black font-medium rounded px-4 py-2">
                  Get started
                </Link>
              </>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 md:py-32">
        <h1 className="text-4xl md:text-5xl font-bold leading-tight max-w-2xl">
          Track Facebook ad conversions into your Telegram channel
        </h1>
        <p className="mt-6 text-lg text-muted max-w-xl">
          burnlink bridges the gap between Facebook Ads and private Telegram channels
          with server-side CAPI attribution. Know exactly which ads drive real channel joins.
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/login"
            className="bg-accent text-black font-semibold rounded-lg px-6 py-3 text-sm hover:opacity-90 transition"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-10">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "User clicks your ad",
                desc: "Facebook sends the click to your burnlink tracking URL with fbclid and UTM params attached.",
              },
              {
                step: "2",
                title: "burnlink bridges the gap",
                desc: "We capture attribution data, fire a CAPI PageView, and instantly redirect to a single-use Telegram invite link.",
              },
              {
                step: "3",
                title: "User joins, CAPI fires",
                desc: "When they join your channel, we match the invite link back to the click and fire a CAPI Lead event to Facebook.",
              },
            ].map((s) => (
              <div key={s.step} className="bg-panel border border-border rounded-xl p-6">
                <div className="text-accent font-bold text-2xl mb-3">{s.step}</div>
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-10">Features</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                title: "Server-side CAPI",
                desc: "PageView on click, Lead on join. Hashed user data for high match quality. No client-side pixel needed.",
              },
              {
                title: "Burn-link pool",
                desc: "Pre-generated single-use invite links. Automatic refill via cron. Never run out of links during a campaign.",
              },
              {
                title: "Auto-discovery",
                desc: "Paste a bot token and we register the webhook. Add the bot to any channel — burnlink detects it automatically.",
              },
              {
                title: "Real-time dashboard",
                desc: "Clicks, joins, join rate, CAPI success rate. Funnel breakdown by UTM campaign, source, and content.",
              },
            ].map((f) => (
              <div key={f.title} className="bg-panel border border-border rounded-xl p-6">
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-20 text-center">
          <h2 className="text-2xl md:text-3xl font-bold">
            Start tracking your Telegram conversions
          </h2>
          <p className="mt-4 text-muted">Free to use. No credit card required.</p>
          <Link
            href="/login"
            className="mt-6 inline-block bg-accent text-black font-semibold rounded-lg px-8 py-3 text-sm hover:opacity-90 transition"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-muted">
          <div>burnlink</div>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-text transition">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
