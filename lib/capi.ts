// Facebook Conversions API client.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
//
// We fire two events:
//   - PageView: on /go hit, anchored to fbclid + event_id
//   - Lead:     on chat_member join, anchored to the click's fbclid + a new event_id
//
// Match quality depends on passing as many hashed user fields as possible.
// All PII is SHA-256'd lowercase-trim before going over the wire.

const GRAPH_VERSION = "v20.0";

export type CapiEventKind = "PageView" | "Lead";

export interface CapiUserData {
  fbclid?: string | null;
  fbc?: string | null;        // full fb.1.<ts>.<fbclid> cookie form
  fbp?: string | null;        // _fbp cookie
  client_ip_address?: string | null;
  client_user_agent?: string | null;
  country?: string | null;    // ISO-2, lowercased before hashing
}

export interface CapiEventInput {
  kind: CapiEventKind;
  event_id: string;
  event_time?: number;        // unix seconds, defaults to now
  event_source_url: string;
  action_source?: "website" | "chat";
  user_data: CapiUserData;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashMaybe(v: string | null | undefined) {
  if (!v) return undefined;
  return sha256Hex(v.trim().toLowerCase());
}

export interface CapiCredentials {
  pixel_id: string;
  access_token: string;
  test_event_code?: string | null;
}

export async function buildCapiPayload(input: CapiEventInput, testEventCode?: string | null) {
  const {
    kind,
    event_id,
    event_time = Math.floor(Date.now() / 1000),
    event_source_url,
    action_source = "website",
    user_data,
  } = input;

  // fbc / fbp are passed through unhashed (they're not PII in FB's schema).
  // IP and UA are passed unhashed too (FB hashes them server-side).
  // country is the only hashed ISO field here.
  const ud: Record<string, unknown> = {};
  if (user_data.fbc) ud.fbc = user_data.fbc;
  if (user_data.fbp) ud.fbp = user_data.fbp;
  if (user_data.client_ip_address) ud.client_ip_address = user_data.client_ip_address;
  if (user_data.client_user_agent) ud.client_user_agent = user_data.client_user_agent;
  const country = await hashMaybe(user_data.country);
  if (country) ud.country = [country];

  return {
    data: [
      {
        event_name: kind,
        event_time,
        event_id,
        event_source_url,
        action_source,
        user_data: ud,
      },
    ],
    ...(testEventCode ?? process.env.FB_TEST_EVENT_CODE
      ? { test_event_code: testEventCode ?? process.env.FB_TEST_EVENT_CODE }
      : {}),
  };
}

export async function fireCapi(
  input: CapiEventInput,
  credentials?: CapiCredentials,
): Promise<{
  status: number;
  body: unknown;
  request: unknown;
}> {
  const pixelId = credentials?.pixel_id ?? process.env.FB_PIXEL_ID;
  const token = credentials?.access_token ?? process.env.FB_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    return {
      status: 0,
      body: { error: "FB credentials not configured" },
      request: input,
    };
  }

  const payload = await buildCapiPayload(input, credentials?.test_event_code);
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(
    token,
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, request: payload };
}

// Convenience: build the "fbc" cookie string per FB's spec if only fbclid is known.
export function buildFbc(fbclid: string | null): string | null {
  if (!fbclid) return null;
  return `fb.1.${Date.now()}.${fbclid}`;
}
