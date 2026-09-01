import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

/** Magic link-landning: byt engångskoden mot en session och gå hem. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (code) {
    const { error } = await supabaseServer().auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL("/", url.origin));
    }
  }

  const login = new URL("/login", url.origin);
  login.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(login);
}
