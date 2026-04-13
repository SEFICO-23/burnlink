"use client";

import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import ThemeToggle from "@/lib/components/ThemeToggle";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setMsg(null);
    const sb = browserClient();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setState("error");
      setMsg(error.message);
      return;
    }
    setState("sent");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text">
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-panel border border-border rounded-xl p-8 space-y-4"
      >
        <h1 className="text-xl font-semibold">burnlink</h1>
        <p className="text-sm text-muted">Sign in with your email</p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="w-full bg-accent text-black font-medium rounded px-3 py-2 text-sm disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send magic link"}
        </button>
        {state === "sent" && (
          <p className="text-ok text-sm">
            Link sent. Check your email.
          </p>
        )}
        {state === "error" && <p className="text-err text-sm">{msg}</p>}
      </form>
    </main>
  );
}
