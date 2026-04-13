import { serviceClient } from "./supabase/server";

export async function logOps(
  level: "info" | "warn" | "error",
  source: "go" | "webhook" | "refill" | "capi" | "bots" | "auth" | "out" | "alerts",
  message: string,
  context?: Record<string, unknown>,
) {
  try {
    const sb = serviceClient();
    await sb.from("ops_log").insert({ level, source, message, context });
  } catch {
    // swallow — logging must not break the main flow
  }
}
