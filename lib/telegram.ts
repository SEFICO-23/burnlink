// Thin wrapper over the Telegram Bot API — only the methods burnlink actually uses.
// Docs: https://core.telegram.org/bots/api

const API_BASE = "https://api.telegram.org";

export interface TgInviteLink {
  invite_link: string;
  name?: string;
  creator: { id: number; is_bot: boolean; username?: string };
  creates_join_request: boolean;
  is_primary: boolean;
  is_revoked: boolean;
  expire_date?: number;
  member_limit?: number;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

const MAX_RETRIES = 3;

async function call<T>(token: string, method: string, params?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    const data = await res.json();
    if (data.ok) return data.result as T;

    if (data.error_code === 429 && attempt < MAX_RETRIES) {
      const wait = (data.parameters?.retry_after ?? 5) + 1;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`tg ${method} failed: ${data.error_code} ${data.description}`);
  }
  throw new Error(`tg ${method}: exhausted retries`);
}

export const tg = {
  async getMe(token: string) {
    return call<TgUser>(token, "getMe");
  },

  async getChat(token: string, chat_id: number) {
    return call<TgChat>(token, "getChat", { chat_id });
  },

  // Creates a single-use ("burn") invite link.
  async createChatInviteLink(
    token: string,
    chat_id: number,
    name: string,
  ): Promise<TgInviteLink> {
    return call<TgInviteLink>(token, "createChatInviteLink", {
      chat_id,
      name,
      member_limit: 1,
      creates_join_request: false,
    });
  },

  async setWebhook(token: string, url: string, secret_token?: string) {
    return call<true>(token, "setWebhook", {
      url,
      allowed_updates: ["chat_member", "my_chat_member", "message"],
      drop_pending_updates: true,
      ...(secret_token ? { secret_token } : {}),
    });
  },

  async deleteWebhook(token: string) {
    return call<true>(token, "deleteWebhook", { drop_pending_updates: false });
  },

  async sendMessage(token: string, chat_id: number, text: string, parse_mode?: "HTML" | "Markdown") {
    return call<{ message_id: number }>(token, "sendMessage", {
      chat_id,
      text,
      ...(parse_mode ? { parse_mode } : {}),
    });
  },
};

export async function createManyInviteLinks(
  token: string,
  chat_id: number,
  count: number,
  concurrency = 3,
  staggerMs = 120,
): Promise<Array<{ invite_link: string; name: string }>> {
  const out: Array<{ invite_link: string; name: string }> = [];
  const queue: Array<() => Promise<void>> = [];

  for (let i = 0; i < count; i++) {
    queue.push(async () => {
      const name = `bl-${crypto.randomUUID().slice(0, 8)}`;
      const res = await tg.createChatInviteLink(token, chat_id, name);
      out.push({ invite_link: res.invite_link, name });
    });
  }

  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const job = queue[idx++];
      await job();
      if (staggerMs) await new Promise((r) => setTimeout(r, staggerMs));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
