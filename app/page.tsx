import { redirect } from "next/navigation";
import { rscClient } from "@/lib/supabase/server";

export default async function Home() {
  const sb = await rscClient();
  const { data } = await sb.auth.getUser();
  if (data.user && data.user.email === process.env.OPERATOR_EMAIL) {
    redirect("/dashboard");
  }
  redirect("/login");
}
