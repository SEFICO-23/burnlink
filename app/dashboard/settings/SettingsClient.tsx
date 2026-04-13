"use client";

import { useState } from "react";

interface Settings {
  slug: string;
  display_name: string | null;
  fb_pixel_id: string | null;
  fb_capi_token: string | null;
  fb_test_code: string | null;
  affiliate_url: string | null;
}

export default function SettingsClient({ initial }: { initial: Settings | null }) {
  const [pixelId, setPixelId] = useState(initial?.fb_pixel_id ?? "");
  const [capiToken, setCapiToken] = useState(initial?.fb_capi_token ?? "");
  const [testCode, setTestCode] = useState(initial?.fb_test_code ?? "");
  const [affiliateUrl, setAffiliateUrl] = useState(initial?.affiliate_url ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = initial?.slug ?? "";
  const trackingUrl = `${origin}/go?uid=${slug}`;
  const outUrl = `${origin}/out?uid=${slug}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fb_pixel_id: pixelId || null,
        fb_capi_token: capiToken || null,
        fb_test_code: testCode || null,
        affiliate_url: affiliateUrl || null,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      setState("error");
      setMsg(body.error ?? "failed");
    } else {
      setState("saved");
      setMsg("Saved.");
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">Tracking URL</h2>
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-xs text-muted mb-2">
            Use this URL as your Facebook ad destination. Add UTM params for campaign breakdown.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm font-mono break-all">
              {trackingUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(trackingUrl)}
              className="bg-accent text-black font-medium rounded px-3 py-2 text-sm whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-muted mt-3">Affiliate redirect URL:</p>
          <code className="block bg-bg border border-border rounded px-3 py-2 text-sm font-mono break-all mt-1">
            {outUrl}
          </code>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Affiliate URL</h2>
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <p className="text-xs text-muted mb-2">
            The destination URL for /out redirects. This is where users go when they click
            the affiliate link in the welcome DM.
          </p>
          <input
            value={affiliateUrl}
            onChange={(e) => setAffiliateUrl(e.target.value)}
            placeholder="https://your-affiliate-offer.com/..."
            className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Facebook CAPI Credentials</h2>
        <form onSubmit={save} className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <label className="block text-xs">
            <span className="text-muted">Pixel ID</span>
            <input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="1234567890"
              className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted">CAPI Access Token</span>
            <input
              type="password"
              value={capiToken}
              onChange={(e) => setCapiToken(e.target.value)}
              placeholder="EAA..."
              className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted">Test Event Code (optional)</span>
            <input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder="TEST12345"
              className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={state === "saving"}
              className="bg-accent text-black font-medium rounded px-4 py-2 text-sm disabled:opacity-60"
            >
              {state === "saving" ? "Saving\u2026" : "Save"}
            </button>
            {msg && <p className="text-xs text-muted">{msg}</p>}
          </div>
        </form>
      </section>
    </div>
  );
}
