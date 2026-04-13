import { NextRequest, NextResponse } from "next/server";
import { serviceClient, rscClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const sb = await rscClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    fb_pixel_id?: string | null;
    fb_capi_token?: string | null;
    fb_test_code?: string | null;
    affiliate_url?: string | null;
  } | null;

  if (!body) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const svc = serviceClient();
  const { error } = await svc
    .from("user_settings")
    .update({
      fb_pixel_id: body.fb_pixel_id,
      fb_capi_token: body.fb_capi_token,
      fb_test_code: body.fb_test_code,
      affiliate_url: body.affiliate_url,
    })
    .eq("id", auth.user.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
