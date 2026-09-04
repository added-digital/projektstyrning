import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCode,
  FORTNOX_SCOPES,
  tenantIdFromAccessToken,
} from "@/lib/integrations/fortnox/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

/** Landning efter samtycke: byt kod → token → tenantId → spara. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/tid?${q}`, url.origin));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookies().get("fortnox_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return back("fortnox=state_mismatch");
  }

  try {
    const token = await exchangeCode(code);
    const tenantId = tenantIdFromAccessToken(token.access_token);
    const user = await getSessionUser();
    const { error } = await supabaseAdmin()
      .from("fortnox_connection")
      .upsert(
        {
          id: true,
          tenant_id: tenantId,
          scopes: [...FORTNOX_SCOPES],
          consented_at: new Date().toISOString(),
          consented_by: user?.email ?? null,
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);
    const res = back("fortnox=connected");
    res.cookies.delete("fortnox_oauth_state");
    return res;
  } catch (err) {
    console.error("[fortnox/callback]", err);
    return back("fortnox=error");
  }
}
