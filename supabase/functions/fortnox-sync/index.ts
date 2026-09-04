/**
 * fortnox-sync — speglar Fortnox tidregistreringar till time_entries.
 *
 *   POST /functions/v1/fortnox-sync
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   { "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD", "trigger"?: "nightly"|"manual" }
 *
 * Utan from/to: idag − 31 dagar → idag (nattkörningen). Med from: backfill.
 *
 * Idempotent: upsert på fortnox_id. Därefter raderas rader i fönstret vars
 * id inte längre finns i Fortnox-svaret — så att borttagna/flyttade
 * registreringar konvergerar. Allt loggas i sync_runs.
 *
 * Anropas bara med service-role-nyckeln (cron via Vault, eller Nexts
 * /api/fortnox/sync). Gatewayens JWT-koll släpper igenom anon också, därför
 * den explicita kontrollen nedan.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { fortnoxGet, getServiceAccessToken } from "../_shared/fortnox.ts";
import {
  defaultWindow,
  splitRange,
  toTimeEntryRow,
  type FortnoxRegistration,
} from "../_shared/map.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CLIENT_ID = Deno.env.get("FORTNOX_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("FORTNOX_CLIENT_SECRET");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Är anroparen service_role? Gatewayen (verify_jwt) har redan verifierat
 * signaturen, så det räcker att läsa role-claimen. Exakt strängmatchning
 * mot env-nyckeln räcker inte: Supabase kan injicera nya sb_secret-formatet
 * medan anroparen använder legacy-JWT:n (eller tvärtom).
 */
function isServiceRole(authHeader: string): boolean {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (!isServiceRole(req.headers.get("Authorization") ?? "")) {
    return json({ error: "Kräver service-role-nyckel" }, 401);
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ error: "FORTNOX_CLIENT_ID/SECRET saknas i secrets" }, 500);
  }

  let body: { from?: string; to?: string; trigger?: string } = {};
  try {
    body = await req.json();
  } catch {
    // tom body = nattkörning
  }

  const win = defaultWindow(new Date(), 31);
  const from = body.from && DATE.test(body.from) ? body.from : win.from;
  const to = body.to && DATE.test(body.to) ? body.to : win.to;
  const trigger = body.trigger === "nightly" ? "nightly" : "manual";
  if (from > to) return json({ error: "from > to" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: conn } = await db
    .from("fortnox_connection")
    .select("tenant_id")
    .maybeSingle();
  if (!conn) {
    return json({ error: "Fortnox är inte kopplat (ingen tenant_id)" }, 409);
  }

  const { data: run, error: runErr } = await db
    .from("sync_runs")
    .insert({ from_date: from, to_date: to, trigger })
    .select("id")
    .single();
  if (runErr || !run) return json({ error: runErr?.message }, 500);

  let upserted = 0;
  let deleted = 0;
  try {
    const token = await getServiceAccessToken({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      tenantId: conn.tenant_id,
    });

    const syncedAt = new Date().toISOString();
    const seenIds: string[] = [];

    for (const chunk of splitRange(from, to)) {
      const regs = await fortnoxGet<FortnoxRegistration[]>(
        token,
        `/api/time/registrations-v2?fromDate=${chunk.from}&toDate=${chunk.to}`,
      );
      const rows = regs.map((r) => toTimeEntryRow(r, syncedAt));
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { error } = await db
          .from("time_entries")
          .upsert(slice, { onConflict: "fortnox_id" });
        if (error) throw new Error(`upsert: ${error.message}`);
        upserted += slice.length;
      }
      seenIds.push(...rows.map((r) => r.fortnox_id));
    }

    // Rader i fönstret som inte längre finns i Fortnox → bort.
    const { data: existing, error: exErr } = await db
      .from("time_entries")
      .select("fortnox_id")
      .gte("worked_date", from)
      .lte("worked_date", to);
    if (exErr) throw new Error(`select existing: ${exErr.message}`);
    const seen = new Set(seenIds);
    const stale = (existing ?? [])
      .map((r) => r.fortnox_id as string)
      .filter((id) => !seen.has(id));
    for (let i = 0; i < stale.length; i += BATCH) {
      const slice = stale.slice(i, i + BATCH);
      const { error } = await db.from("time_entries").delete().in("fortnox_id", slice);
      if (error) throw new Error(`delete stale: ${error.message}`);
      deleted += slice.length;
    }

    const finishedAt = new Date().toISOString();
    await db
      .from("sync_runs")
      .update({
        finished_at: finishedAt,
        status: "ok",
        entries_upserted: upserted,
        entries_deleted: deleted,
      })
      .eq("id", run.id);
    await db
      .from("fortnox_connection")
      .update({ last_sync_at: finishedAt, last_sync_status: "ok" })
      .eq("id", true);

    return json({ runId: run.id, from, to, upserted, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error: message,
        entries_upserted: upserted,
        entries_deleted: deleted,
      })
      .eq("id", run.id);
    await db
      .from("fortnox_connection")
      .update({ last_sync_status: "error" })
      .eq("id", true);
    return json({ runId: run.id, error: message }, 502);
  }
});
