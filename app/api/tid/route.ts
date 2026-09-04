import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const PERIODS = new Set(["week", "month", "year"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface HoursBucket {
  period_start: string;
  worker_id: string | null;
  worker_name: string;
  hours: number;
}

/**
 * Timmar per medarbetare och period, aggregerat i databasen
 * (hours_by_period, M11). ?period=week|month|year&from=&to=&codes=TID,SEM
 * Standard: TID (arbetad tid) — frånvaro filtreras bort.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "month";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const codes = (url.searchParams.get("codes") ?? "TID")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (!PERIODS.has(period)) {
    return NextResponse.json({ error: "period måste vara week|month|year" }, { status: 400 });
  }
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    return NextResponse.json({ error: "from/to måste vara YYYY-MM-DD och from ≤ to" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().rpc("hours_by_period", {
    p_period: period,
    p_from: from,
    p_to: to,
    p_codes: codes,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const buckets = (data as HoursBucket[]).map((b) => ({ ...b, hours: Number(b.hours) }));
  return NextResponse.json({ period, from, to, codes, buckets });
}
