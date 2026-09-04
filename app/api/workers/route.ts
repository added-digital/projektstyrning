import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Medarbetare + Fortnox-mappning.
 *
 * GET   → { workers, unmapped }  där unmapped är Fortnox-userId:n som
 *         förekommer i time_entries men inte hör till någon medarbetare.
 * PATCH → { id, fortnox_user_id } sätter/nollar mappningen. Triggern i M8
 *         kopplar om historiken.
 */
export async function GET() {
  const db = supabaseAdmin();
  const [workers, unmapped] = await Promise.all([
    db.from("workers").select("id, name, fortnox_user_id, active, sort").order("sort"),
    db
      .from("time_entries")
      .select("fortnox_user_id, worked_hours, worked_date")
      .is("worker_id", null)
      .not("fortnox_user_id", "is", null),
  ]);
  if (workers.error) return NextResponse.json({ error: workers.error.message }, { status: 500 });
  if (unmapped.error) return NextResponse.json({ error: unmapped.error.message }, { status: 500 });

  // Summera per okopplat id så UI:t kan visa "id 42 — 312 h, senast 2026-08-30".
  const byId = new Map<string, { fortnox_user_id: string; hours: number; latest: string; entries: number }>();
  for (const row of unmapped.data ?? []) {
    const id = row.fortnox_user_id as string;
    const cur = byId.get(id) ?? { fortnox_user_id: id, hours: 0, latest: "", entries: 0 };
    cur.hours += Number(row.worked_hours);
    cur.entries += 1;
    if (row.worked_date > cur.latest) cur.latest = row.worked_date;
    byId.set(id, cur);
  }

  return NextResponse.json({
    workers: workers.data,
    unmapped: [...byId.values()].sort((a, b) => b.hours - a.hours),
  });
}

export async function PATCH(req: Request) {
  let body: { id?: string; fortnox_user_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ogiltig JSON" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id krävs" }, { status: 400 });
  const fortnoxUserId =
    typeof body.fortnox_user_id === "string" && body.fortnox_user_id.trim()
      ? body.fortnox_user_id.trim()
      : null;

  const { data, error } = await supabaseAdmin()
    .from("workers")
    .update({ fortnox_user_id: fortnoxUserId })
    .eq("id", body.id)
    .select("id, name, fortnox_user_id")
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500; // unique: id:t används redan
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ worker: data });
}
