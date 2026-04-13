"use client";

import { useState } from "react";

interface WelcomeMessage {
  id: string;
  bot_id: string;
  channel_id: number;
  message: string;
  is_active: boolean;
}

interface BotChannel {
  id: string;
  username: string;
  channel_id: number;
}

export default function MessagesClient({
  initial,
  bots,
}: {
  initial: WelcomeMessage[];
  bots: BotChannel[];
}) {
  const [messages, setMessages] = useState(initial);
  const [selectedBot, setSelectedBot] = useState(bots[0]?.id ?? "");
  const [text, setText] = useState("Welcome! {out_link}");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const selectedBotObj = bots.find((b) => b.id === selectedBot);

  // Bot-channel pairs that don't have a message yet
  const unconfigured = bots.filter(
    (b) => !messages.some((m) => m.bot_id === b.id && m.channel_id === b.channel_id),
  );

  async function addMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBotObj) return;
    setState("saving");
    setMsg(null);

    const res = await fetch("/api/welcome-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bot_id: selectedBotObj.id,
        channel_id: selectedBotObj.channel_id,
        message: text,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      setState("error");
      setMsg(body.error ?? "failed");
      return;
    }
    setMessages([body.data, ...messages.filter(
      (m) => !(m.bot_id === body.data.bot_id && m.channel_id === body.data.channel_id),
    )]);
    setState("idle");
    setMsg("Saved.");
  }

  async function toggleActive(wm: WelcomeMessage) {
    const res = await fetch("/api/welcome-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bot_id: wm.bot_id,
        channel_id: wm.channel_id,
        message: wm.message,
        is_active: !wm.is_active,
      }),
    });
    const body = await res.json();
    if (body.ok) {
      setMessages(messages.map((m) => (m.id === wm.id ? { ...m, is_active: !wm.is_active } : m)));
    }
  }

  async function deleteMessage(id: string) {
    if (!confirm("Delete this welcome message?")) return;
    const res = await fetch(`/api/welcome-messages?id=${id}`, { method: "DELETE" });
    const body = await res.json();
    if (body.ok) {
      setMessages(messages.filter((m) => m.id !== id));
    }
  }

  // Find bot username by id
  function botLabel(botId: string, channelId: number) {
    const b = bots.find((x) => x.id === botId);
    return b ? `@${b.username} #${channelId}` : `#${channelId}`;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">Add welcome message</h2>
        {unconfigured.length === 0 ? (
          <div className="bg-panel border border-border rounded-xl p-5">
            <p className="text-xs text-muted">
              {bots.length === 0
                ? "No active bots with channels. Add a bot and connect it to a channel first."
                : "All bot-channel pairs have welcome messages configured."}
            </p>
          </div>
        ) : (
          <form onSubmit={addMessage} className="bg-panel border border-border rounded-xl p-5 space-y-3">
            <label className="block text-xs">
              <span className="text-muted">Bot &amp; channel</span>
              <select
                value={selectedBot}
                onChange={(e) => setSelectedBot(e.target.value)}
                className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 text-sm"
              >
                {unconfigured.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.username} #{b.channel_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-muted">Message template</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="mt-1 w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono"
              />
              <span className="text-muted">
                Use <code className="bg-bg px-1 rounded">{"{out_link}"}</code> where the affiliate redirect URL should appear.
              </span>
            </label>
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={state === "saving"}
                className="bg-accent text-black font-medium rounded px-4 py-2 text-sm disabled:opacity-60"
              >
                {state === "saving" ? "Saving..." : "Save"}
              </button>
              {msg && <p className="text-xs text-muted">{msg}</p>}
            </div>
          </form>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Configured messages</h2>
        <div className="bg-panel border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr className="text-left">
                <th className="p-2 md:p-3 font-medium">Bot / Channel</th>
                <th className="p-2 md:p-3 font-medium">Message</th>
                <th className="p-2 md:p-3 font-medium">Status</th>
                <th className="p-2 md:p-3"></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="p-2 md:p-3 text-xs font-mono whitespace-nowrap">
                    {botLabel(m.bot_id, m.channel_id)}
                  </td>
                  <td className="p-2 md:p-3 text-xs max-w-xs truncate">{m.message}</td>
                  <td className="p-2 md:p-3">
                    <button
                      onClick={() => toggleActive(m)}
                      className={m.is_active ? "text-ok text-xs" : "text-muted text-xs"}
                    >
                      {m.is_active ? "active" : "paused"}
                    </button>
                  </td>
                  <td className="p-2 md:p-3 text-right">
                    <button
                      onClick={() => deleteMessage(m.id)}
                      className="text-xs text-err hover:underline"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted">
                    No welcome messages configured yet.
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
