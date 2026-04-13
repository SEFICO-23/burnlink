import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serviceClient } from "@/lib/supabase/server";

type CookieSetItem = { name: string; value: string; options: CookieOptions };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", req.url));

  const store = await cookies();
  const res = NextResponse.redirect(new URL("/dashboard", req.url));

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items: CookieSetItem[]) => {
          items.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=1", req.url));

  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", req.url));

  // Check if user has completed onboarding
  const svc = serviceClient();
  const { data: settings } = await svc
    .from("user_settings")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!settings) {
    // New user — redirect to onboarding
    const onboardRes = NextResponse.redirect(new URL("/onboarding", req.url));
    res.cookies.getAll().forEach((c) => onboardRes.cookies.set(c.name, c.value));
    return onboardRes;
  }

  return res;
}
