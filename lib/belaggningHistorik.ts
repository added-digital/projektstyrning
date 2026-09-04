import "server-only";
import { supabaseAdmin } from "./supabase";
import type { OccupancySource } from "./belaggning";

/**
 * Historisk beläggning — arbetad tid bakåt i tiden, från Fortnox.
 *
 * Läser time_entries (speglad av edge-funktionen fortnox-sync) och summerar
 * arbetad tid (registreringskod TID) per dag för en person. Personen
 * identifieras med sitt namn i teamlistan, som matchar workers.name; kopplingen
 * till Fortnox userId ligger i workers.fortnox_user_id (sätts på /tid).
 *
 * Regler:
 *  - bara TID räknas — semester/VAB/sjuk är inte arbetad tid
 *  - dagar utan registrering saknas i svaret ⇒ 0 h (kontraktet nedan)
 *  - en person utan Fortnox-koppling ger tomt svar, inte ett fel: vyn visar
 *    då 0 h bakåt, och mappningen fixas på /tid
 */

export interface HistoricalSource {
  /** Sätts som `source` på varje datapunkt så stub- och riktig data kan skiljas åt. */
  readonly id: Exclude<OccupancySource, "allocation">;
  /**
   * Arbetade timmar per dag för en person i [from, to] (inklusive).
   * Dagar som saknas i svaret tolkas som 0 h.
   */
  getWorkedHours(
    personId: string,
    from: string,
    to: string,
  ): Promise<Record<string, number>>;
}

export const fortnoxHistoricalSource: HistoricalSource = {
  id: "fortnox",
  async getWorkedHours(personId, from, to) {
    const db = supabaseAdmin();
    const { data: worker, error: wErr } = await db
      .from("workers")
      .select("id")
      .eq("name", personId)
      .maybeSingle();
    if (wErr) throw new Error(`workers: ${wErr.message}`);
    if (!worker) return {};

    const { data, error } = await db
      .from("time_entries")
      .select("worked_date, worked_hours")
      .eq("worker_id", worker.id)
      .eq("registration_code", "TID")
      .gte("worked_date", from)
      .lte("worked_date", to);
    if (error) throw new Error(`time_entries: ${error.message}`);

    const out: Record<string, number> = {};
    for (const row of data ?? []) {
      const d = row.worked_date as string;
      out[d] = (out[d] ?? 0) + Number(row.worked_hours);
    }
    return out;
  },
};

/** Aktiv historikkälla. */
export function getHistoricalSource(): HistoricalSource {
  return fortnoxHistoricalSource;
}
