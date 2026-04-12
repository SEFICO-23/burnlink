"use client";

import { useState } from "react";

interface Bot {
  id: string;
  username: string;
  channel_id: number;
  is_active: boolean;
  last_refill_at: string | null;
  last_error: string | null;
  created_at: string;
}

export default function BotsClient({ initial }: { initial: Bot[] }) {
  const [bots, setBots] = useState(initial);
  const [token, setToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [state, setState] = useState<"idle" | "adding" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function addBot(e: React.FormEvent) {
    e.preventDefault();
    setState("adding");
    setMsg(null);
    const res = await fetch("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, channel_id: Number(channelId) }),
    });
    const body = await res.json();
    if (!body.ok) {
      setState("error");
      setMsg(body.error ?? "failed");
      return;
    }
    setBots([body.bot, ...bots]);
    setToken("");
    setChannelId("");
    setState("idle");
    setMsg(
      `Added. Seed refill: created ${body.refill?.created ?? 0} links (${body.refill?.reason ?? "?"}).`,
    );
  }

  async function removeBot(id: string) {
    if (!confirm("Deactivate this bot? Unused links stay in the pool but no new ones will be created.")) return;
    const res = await fetch(`/api/bots?id=${id}`, { method: "DELETE" });
    const body = await res.json();
    if (body.ok) {
      setBots(bots.map((b) => (b.id === id ? { ...b, is_active: false } : b)));
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">Add a bot</h2>
        <form onSubmit={addBot} className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="text-muted">BotFather token</span>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456:AA..."
                required
                className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-xs">
              <span className="text-muted">Channel ID (e.g. -1001234567890)</span>
              <input
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="-1001234567890"
                required
                className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 font-mono text-xs"
              />
            </label>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={state === "adding"}
              className="bg-accent text-black font-medium rounded px-4 py-2 text-sm disabled:opacity-60"
            >
              {state === "adding" ? "Adding and seeding 1000 links…" : "Add bot"}
            </button>
            {msg && <p className="text-xs text-muted">{msg}</p>}
          </div>
        </form>
        <p className="text-xs text-muted mt-2">
          The bot must already be an admin of the channel with the &ldquo;Invite users&rdquo;
          permission. This will create 1000 single-use invite links inline.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Configured bots</h2>
        <div className="bg-panel border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr className="text-left">
                <th className="p-3 font-medium">Bot</th>
                <th className="p-3 font-medium">Channel</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Last refill</th>
                <th className="p-3 font-medium">Error</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="p-3 font-mono text-xs">{b.username}</td>
                  <td className="p-3 font-mono text-xs">{b.channel_id}</td>
                  <td className="p-3">
                    <span className={b.is_active ? "text-ok" : "text-muted"}>
                      {b.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted">
                    {b.last_refill_at ? new Date(b.last_refill_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-xs text-err">{b.last_error ?? "—"}</td>
                  <td className="p-3 text-right">
                    {b.is_active && (
                      <button
                        onClick={() => removeBot(b.id)}
                        className="text-xs text-err hover:underline"
                      >
                        deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {bots.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted">
                    No bots yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
