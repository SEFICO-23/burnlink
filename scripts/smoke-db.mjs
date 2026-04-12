// Smoke test: verify the app can reach Supabase via the service-role key.
// Reusable: run with `node scripts/smoke-db.mjs` from the repo root.
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

let passed = 0;
const total = 4;

// (a) Schema present — proxy via app_config single() (success = auth + RLS bypass).
try {
  const { data, error } = await supabase
    .from('app_config')
    .select('operator_email')
    .single();
  if (error) {
    console.log(`FAIL (a) schema/auth: ${error.message}`);
  } else {
    console.log(`PASS (a) schema/auth: app_config reachable, operator_email=${data.operator_email}`);
    passed++;
  }
} catch (e) {
  console.log(`FAIL (a) schema/auth: ${e.message}`);
}

// (b) app_config seed
try {
  const { data, error } = await supabase
    .from('app_config')
    .select('operator_email')
    .eq('id', 1)
    .single();
  if (error) {
    console.log(`FAIL (b) app_config seed: ${error.message}`);
  } else if (data?.operator_email !== 'wordlw82@gmail.com') {
    console.log(`FAIL (b) app_config seed: expected wordlw82@gmail.com, got ${data?.operator_email}`);
  } else {
    console.log(`PASS (b) app_config seed: id=1 operator_email=${data.operator_email}`);
    passed++;
  }
} catch (e) {
  console.log(`FAIL (b) app_config seed: ${e.message}`);
}

// (c) ops_log round-trip
try {
  const ins = await supabase
    .from('ops_log')
    .insert({
      level: 'info',
      source: 'smoke',
      message: 'smoke test',
      context: { run_at: new Date().toISOString() },
    })
    .select('id')
    .single();
  if (ins.error) throw new Error(`insert: ${ins.error.message}`);
  const id = ins.data.id;

  const read = await supabase.from('ops_log').select('*').eq('id', id).single();
  if (read.error) throw new Error(`read: ${read.error.message}`);
  if (read.data.source !== 'smoke') throw new Error(`read-back source mismatch: ${read.data.source}`);

  const del = await supabase.from('ops_log').delete().eq('id', id);
  if (del.error) throw new Error(`delete: ${del.error.message}`);

  console.log(`PASS (c) ops_log round-trip: insert/read/delete id=${id}`);
  passed++;
} catch (e) {
  console.log(`FAIL (c) ops_log round-trip: ${e.message}`);
}

// (d) pop_unused_link RPC reachable
try {
  const { data, error } = await supabase.rpc('pop_unused_link', {
    p_click_id: '00000000-0000-0000-0000-000000000000',
  });
  if (error) {
    console.log(`FAIL (d) pop_unused_link rpc: ${error.message}`);
  } else {
    const len = Array.isArray(data) ? data.length : (data == null ? 0 : 1);
    console.log(`PASS (d) pop_unused_link rpc: error=null rows=${len}`);
    passed++;
  }
} catch (e) {
  console.log(`FAIL (d) pop_unused_link rpc: ${e.message}`);
}

// Final cleanup verification — count leftover smoke rows.
try {
  const { data, error, count } = await supabase
    .from('ops_log')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'smoke');
  if (error) {
    console.log(`FAIL cleanup-check: ${error.message}`);
    process.exit(1);
  }
  const leftover = count ?? (Array.isArray(data) ? data.length : 0);
  if (leftover !== 0) {
    console.log(`FAIL cleanup-check: ${leftover} leftover ops_log rows with source='smoke'`);
    console.log(`SMOKE FAILED: ${passed}/${total} checks passed (cleanup leak)`);
    process.exit(1);
  }
  console.log(`PASS cleanup-check: 0 leftover ops_log rows with source='smoke'`);
} catch (e) {
  console.log(`FAIL cleanup-check: ${e.message}`);
  process.exit(1);
}

if (passed === total) {
  console.log(`SMOKE OK: ${passed}/${total} checks passed`);
  process.exit(0);
} else {
  console.log(`SMOKE FAILED: ${passed}/${total} checks passed`);
  process.exit(1);
}
