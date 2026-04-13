// Re-register Telegram webhooks for all active bots with updated allowed_updates.
// Run once: `node scripts/reregister-webhooks.mjs`
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- Load .env.local without bringing in `dotenv` ---
try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
} catch (e) {
  console.error('FAIL: could not read .env.local:', e.message);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.TG_WEBHOOK_SECRET;
// Use production URL, not localhost
const appUrl = 'https://burnlink-orcin.vercel.app';

if (!url || !serviceKey || !secret) {
  console.error('FAIL: missing env vars');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Fetch all active bots — deduplicate by token (same bot may have multiple channel rows)
const { data: bots, error } = await supabase
  .from('bots')
  .select('id, username, token')
  .eq('is_active', true);

if (error || !bots) {
  console.error('FAIL: could not fetch bots:', error?.message);
  process.exit(1);
}

// Deduplicate by token — only need one setWebhook per physical bot
const seen = new Set();
const unique = bots.filter((b) => {
  if (seen.has(b.token)) return false;
  seen.add(b.token);
  return true;
});

console.log(`Re-registering webhooks for ${unique.length} bot(s)…\n`);
const webhookUrl = `${appUrl}/api/telegram/webhook/${secret}`;

let ok = 0;
for (const bot of unique) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['chat_member', 'my_chat_member', 'message'],
        secret_token: secret,
        drop_pending_updates: true,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`OK   ${bot.username}: webhook set (chat_member + my_chat_member + message)`);
      ok++;
    } else {
      console.log(`FAIL ${bot.username}: ${data.description}`);
    }
  } catch (e) {
    console.log(`FAIL ${bot.username}: ${e.message}`);
  }
}

console.log(`\nDone: ${ok}/${unique.length} webhooks re-registered.`);
process.exit(ok === unique.length ? 0 : 1);
