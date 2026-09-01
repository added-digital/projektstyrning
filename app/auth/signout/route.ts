import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await supabaseServer().auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(req.url).origin), {
    status: 303,
  });
}
