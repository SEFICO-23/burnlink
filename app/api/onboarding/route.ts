import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    display_name?: string;
    slug?: string;
    fb_pixel_id?: string;
    fb_capi_token?: string;
  } | null;

  if (!body?.slug || !/^[a-z0-9\-]+$/.test(body.slug)) {
    return NextResponse.json(
      { ok: false, error: "slug required (lowercase letters, numbers, hyphens)" },
      { status: 400 },
    );
  }

  const svc = serviceClient();

  // Check slug uniqueness
  const { data: existing } = await svc
    .from("user_settings")
    .select("id")
    .eq("slug", body.slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { ok: false, error: "This slug is already taken" },
      { status: 409 },
    );
  }

  const { error } = await svc.from("user_settings").insert({
    id: auth.user.id,
    display_name: body.display_name || null,
    slug: body.slug,
    fb_pixel_id: body.fb_pixel_id || null,
    fb_capi_token: body.fb_capi_token || null,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
