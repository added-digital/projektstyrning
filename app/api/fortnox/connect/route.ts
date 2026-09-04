import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildConsentUrl } from "@/lib/integrations/fortnox/auth";

export const dynamic = "force-dynamic";

/**
 * Startar engångs-samtycket. Den som klickar måste vara systemadministratör
 * i Fortnox — annars nekar Fortnox service account-alternativet.
 */
export async function GET(req: Request) {
  const state = randomBytes(16).toString("hex");
  let url: string;
  try {
    url = buildConsentUrl(state);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("fortnox_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    path: "/api/fortnox/callback",
    maxAge: 600,
  });
  return res;
}
