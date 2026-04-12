// Vercel Cron — top up any bot pool that's dropped below POOL_FLOOR.

import { NextRequest, NextResponse } from "next/server";
import { refillAllActive } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel Cron sets this header; operator manual triggers must pass ?secret=
  const auth = req.headers.get("authorization");
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const manualSecret = new URL(req.url).searchParams.get("secret");
  const isManual = manualSecret && manualSecret === process.env.CRON_SECRET;

  if (!isCron && !isManual) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const results = await refillAllActive();
  return NextResponse.json({ ok: true, results });
}
