// Backfill FB_PIXEL_ID and FB_CAPI_ACCESS_TOKEN into user_settings for the operator.
// Run once: `node scripts/backfill-fb-credentials.mjs`
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- Load .env.local ---
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
const pixelId = process.env.FB_PIXEL_ID;
const capiToken = process.env.FB_CAPI_ACCESS_TOKEN;
const testCode = process.env.FB_TEST_EVENT_CODE || null;

if (!url || !serviceKey) {
  console.error('FAIL: missing Supabase env vars');
  process.exit(1);
}
if (!pixelId || !capiToken) {
  console.error('FAIL: missing FB_PIXEL_ID or FB_CAPI_ACCESS_TOKEN');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from('user_settings')
  .update({ fb_pixel_id: pixelId, fb_capi_token: capiToken, fb_test_code: testCode })
  .eq('is_admin', true)
  .select('id, slug, fb_pixel_id')
  .single();

if (error) {
  console.error('FAIL:', error.message);
  process.exit(1);
}

console.log('OK: backfilled FB credentials for admin user');
console.log('  slug:', data.slug);
console.log('  fb_pixel_id:', data.fb_pixel_id);
process.exit(0);
