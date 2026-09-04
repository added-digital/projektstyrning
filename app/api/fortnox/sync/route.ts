import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Manuell synk. Sessionen är redan verifierad av middleware; härifrån
 * anropas edge-funktionen med service-role-nyckeln. Själva synken körs
 * alltså i edge-funktionen, inte i Nexts request-path.
 *
 * Body: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
 */
export async function POST(req: Request) {
  let body: { from?: string; to?: string } = {};
  try {
    body = await req.json();
  } catch {
    // tom body = standardfönster (idag − 31 dagar)
  }
  if (body.from && !DATE.test(body.from)) {
    return NextResponse.json({ error: "Ogiltigt from-datum" }, { status: 400 });
  }
  if (body.to && !DATE.test(body.to)) {
    return NextResponse.json({ error: "Ogiltigt to-datum" }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return NextResponse.json({ error: "Supabase saknar konfiguration" }, { status: 500 });
  }

  const res = await fetch(`${base}/functions/v1/fortnox-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: body.from, to: body.to, trigger: "manual" }),
  });
  const json = await res.json().catch(() => ({ error: "Ogiltigt svar från synk" }));
  return NextResponse.json(json, { status: res.status });
}
