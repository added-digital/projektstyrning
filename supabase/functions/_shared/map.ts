/**
 * Fortnox tidregistrering → rad i time_entries.
 *
 * Medvetet självständig (inga imports): filen körs både i edge-funktionen
 * (Deno) och i vitest (Node), så den får inte bero på någondera runtime.
 * Håll den ren — det är den som testerna vaktar.
 */

/** Så mycket av /api/time/registrations-v2-svaret som vi bryr oss om. */
export interface FortnoxRegistration {
  id: string;
  userId?: string | null;
  workedDate: string;
  workedHours?: number | null;
  chargeHours?: number | null;
  registrationCode?: { code?: string | null; name?: string | null } | null;
  customer?: { id?: string | number | null; name?: string | null } | null;
  project?: {
    id?: string | number | null;
    name?: string | null;
    description?: string | null;
  } | null;
  service?: {
    id?: string | number | null;
    name?: string | null;
    description?: string | null;
  } | null;
  invoiceText?: string | null;
  note?: string | null;
  nonInvoiceable?: boolean | null;
  invoiceBasisId?: number | null;
  documentId?: number | null;
  documentType?: string | null;
  unitCost?: number | null;
  unitPrice?: number | null;
  createdTime?: string | null;
  updatedBy?: string | null;
}

export interface TimeEntryRow {
  fortnox_id: string;
  worked_date: string;
  worked_hours: number;
  charge_hours: number;
  registration_code: string;
  fortnox_user_id: string | null;
  fortnox_customer_id: string | null;
  fortnox_customer_name: string | null;
  fortnox_project_id: string | null;
  fortnox_project_name: string | null;
  fortnox_service_id: string | null;
  fortnox_service_name: string | null;
  invoice_text: string | null;
  note: string | null;
  non_invoiceable: boolean;
  invoice_basis_id: number | null;
  document_id: number | null;
  document_type: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  fortnox_created_at: string | null;
  fortnox_updated_by: string | null;
  raw: FortnoxRegistration;
  synced_at: string;
}

function idOrNull(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function textOrNull(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Fortnox skickar ibland datum med tid; vi vill bara ha YYYY-MM-DD. */
export function toDateOnly(v: string): string {
  return v.slice(0, 10);
}

export function toTimeEntryRow(
  reg: FortnoxRegistration,
  syncedAt: string,
): TimeEntryRow {
  return {
    fortnox_id: String(reg.id),
    worked_date: toDateOnly(reg.workedDate),
    worked_hours: num(reg.workedHours),
    charge_hours: num(reg.chargeHours),
    // Okänd/tom kod ⇒ "TID": Fortnox utelämnar koden för vanlig arbetstid
    // i vissa svar, och frånvaro har alltid en explicit kod.
    registration_code: textOrNull(reg.registrationCode?.code) ?? "TID",
    fortnox_user_id: textOrNull(reg.userId),
    fortnox_customer_id: idOrNull(reg.customer?.id),
    fortnox_customer_name: textOrNull(reg.customer?.name),
    fortnox_project_id: idOrNull(reg.project?.id),
    fortnox_project_name:
      textOrNull(reg.project?.name) ?? textOrNull(reg.project?.description),
    fortnox_service_id: idOrNull(reg.service?.id),
    fortnox_service_name:
      textOrNull(reg.service?.name) ?? textOrNull(reg.service?.description),
    invoice_text: textOrNull(reg.invoiceText),
    note: textOrNull(reg.note),
    non_invoiceable: reg.nonInvoiceable === true,
    invoice_basis_id: numOrNull(reg.invoiceBasisId),
    document_id: numOrNull(reg.documentId),
    document_type: textOrNull(reg.documentType),
    unit_cost: numOrNull(reg.unitCost),
    unit_price: numOrNull(reg.unitPrice),
    fortnox_created_at: textOrNull(reg.createdTime),
    fortnox_updated_by: textOrNull(reg.updatedBy),
    raw: reg,
    synced_at: syncedAt,
  };
}

/** Synkfönster: från `daysBack` dagar bakåt till och med idag. */
export function defaultWindow(
  today: Date,
  daysBack: number,
): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - daysBack * 86_400_000);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

/**
 * Fortnox tillåter max ett års spann per anrop. Delar ett längre spann i
 * bitar om max 365 dagar (inklusive båda ändar).
 */
export function splitRange(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let cursor = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cursor <= end) {
    const chunkEnd = new Date(cursor.getTime() + 364 * 86_400_000);
    const stop = chunkEnd < end ? chunkEnd : end;
    out.push({
      from: cursor.toISOString().slice(0, 10),
      to: stop.toISOString().slice(0, 10),
    });
    cursor = new Date(stop.getTime() + 86_400_000);
  }
  return out;
}
