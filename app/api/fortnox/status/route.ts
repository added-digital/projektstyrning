import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Kopplingsstatus för UI:t. Exponerar aldrig tenant_id — bara att en
 * koppling finns, när samtycket gavs och hur senaste synken gick.
 */
export async function GET() {
  const db = supabaseAdmin();
  const [conn, runs] = await Promise.all([
    db
      .from("fortnox_connection")
      .select("consented_at, consented_by, scopes, last_sync_at, last_sync_status")
      .maybeSingle(),
    db
      .from("sync_runs")
      .select("id, started_at, finished_at, from_date, to_date, trigger, entries_upserted, entries_deleted, status, error")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);
  if (conn.error) return NextResponse.json({ error: conn.error.message }, { status: 500 });
  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 500 });
  return NextResponse.json({
    connected: Boolean(conn.data),
    connection: conn.data,
    runs: runs.data,
  });
}
