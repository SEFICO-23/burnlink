"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function generateSlug() {
  return "bl-" + Math.random().toString(36).slice(2, 8);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(generateSlug());
  const [pixelId, setPixelId] = useState("");
  const [capiToken, setCapiToken] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);

    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: name || null,
        slug,
        fb_pixel_id: pixelId || null,
        fb_capi_token: capiToken || null,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      setState("error");
      setError(body.error ?? "failed");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-panel border border-border rounded-xl p-8 space-y-5"
      >
        <div>
          <h1 className="text-xl font-semibold">Welcome to burnlink</h1>
          <p className="text-sm text-muted mt-1">Set up your account to start tracking.</p>
        </div>

        <label className="block text-xs">
          <span className="text-muted">Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name or brand"
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs">
          <span className="text-muted">Your tracking slug (used in /go?uid=...)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9\-]+"
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <hr className="border-border" />
        <p className="text-xs text-muted">
          Facebook credentials (optional — you can add these later in Settings).
        </p>

        <label className="block text-xs">
          <span className="text-muted">FB Pixel ID</span>
          <input
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value)}
            placeholder="1234567890"
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <label className="block text-xs">
          <span className="text-muted">FB CAPI Access Token</span>
          <input
            type="password"
            value={capiToken}
            onChange={(e) => setCapiToken(e.target.value)}
            placeholder="EAA..."
            className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={state === "saving"}
          className="w-full bg-accent text-black font-medium rounded px-3 py-2 text-sm disabled:opacity-60"
        >
          {state === "saving" ? "Saving\u2026" : "Continue to dashboard"}
        </button>
        {error && <p className="text-err text-sm">{error}</p>}
      </form>
    </main>
  );
}
