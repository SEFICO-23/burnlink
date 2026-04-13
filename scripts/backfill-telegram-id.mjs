// Backfill telegram_id for existing bots that were added before auto-discovery.
// Run once: `node scripts/backfill-telegram-id.mjs`
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
if (!url || !serviceKey) {
  console.error('FAIL: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Fetch all bots with telegram_id = null
const { data: bots, error } = await supabase
  .from('bots')
  .select('id, username, token, telegram_id')
  .is('telegram_id', null);

if (error) {
  console.error('FAIL: could not fetch bots:', error.message);
  process.exit(1);
}

if (!bots || bots.length === 0) {
  console.log('OK: no bots need backfill (all have telegram_id set)');
  process.exit(0);
}

console.log(`Found ${bots.length} bot(s) with telegram_id=null. Backfilling…\n`);

let updated = 0;
for (const bot of bots) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const data = await res.json();
    if (!data.ok) {
      console.log(`SKIP ${bot.username} (${bot.id}): getMe failed — ${data.description}`);
      continue;
    }

    const tgId = data.result.id;
    const { error: upErr } = await supabase
      .from('bots')
      .update({ telegram_id: tgId })
      .eq('id', bot.id);

    if (upErr) {
      console.log(`FAIL ${bot.username} (${bot.id}): update failed — ${upErr.message}`);
    } else {
      console.log(`OK   ${bot.username} (${bot.id}): telegram_id = ${tgId}`);
      updated++;
    }
  } catch (e) {
    console.log(`FAIL ${bot.username} (${bot.id}): ${e.message}`);
  }
}

console.log(`\nDone: ${updated}/${bots.length} bots backfilled.`);
process.exit(updated === bots.length ? 0 : 1);
