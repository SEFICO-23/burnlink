import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieSetItem = { name: string; value: string; options: CookieOptions };

// Gate /dashboard/**. Everything else is public.
export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/dashboard")) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (items: CookieSetItem[]) => {
          items.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.email !== process.env.OPERATOR_EMAIL) {
    const login = new URL("/login", req.url);
    return NextResponse.redirect(login);
  }
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
