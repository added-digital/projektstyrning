/**
 * Rena hjälpare för tidsgrafen: periodintervall och pivot av
 * hours_by_period-svaret till ett radformat grafen och tabellen delar.
 * Inga fetch-anrop här — det gör den testbar.
 */

export type Period = "week" | "month" | "year";

export interface HoursBucket {
  period_start: string;
  worker_id: string | null;
  worker_name: string;
  hours: number;
}

export interface PivotRow {
  period_start: string;
  label: string;
  total: number;
  /** worker_name → timmar */
  byWorker: Record<string, number>;
}

export interface Pivot {
  rows: PivotRow[];
  /** Serier i fast ordning: kopplade medarbetare först (i given ordning), okopplade sist. */
  series: string[];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Måndagen i ISO-veckan som innehåller d (UTC). */
export function startOfIsoWeek(d: Date): Date {
  const day = d.getUTCDay() || 7; // sön=0 → 7
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() - (day - 1));
  return out;
}

/** ISO-veckonummer för ett datum (UTC). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * Standardintervall per period, räknat från `today`:
 *  week  → senaste 12 veckorna (inkl. innevarande)
 *  month → innevarande år
 *  year  → 2026 → innevarande år (Fortnox-historiken börjar 2026)
 */
export function defaultRange(period: Period, today: Date): { from: string; to: string } {
  const to = iso(today);
  if (period === "week") {
    const thisMonday = startOfIsoWeek(today);
    const from = new Date(thisMonday.getTime() - 11 * 7 * 86_400_000);
    return { from: iso(from), to };
  }
  if (period === "month") {
    return { from: `${today.getUTCFullYear()}-01-01`, to };
  }
  return { from: "2026-01-01", to };
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export function periodLabel(period: Period, periodStart: string): string {
  const d = new Date(periodStart + "T00:00:00Z");
  if (period === "week") return `v${isoWeek(d)}`;
  if (period === "month") return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return String(d.getUTCFullYear());
}

/**
 * Buckets → en rad per period med en kolumn per medarbetare. `workerOrder`
 * (namn i teamets ordning) bestämmer seriernas färgslot; färgen följer
 * personen, inte storleken. Okopplade hamnar sist. Perioder utan data
 * fylls inte i här — det gör grafen utifrån intervallet.
 */
export function pivotBuckets(
  buckets: HoursBucket[],
  period: Period,
  workerOrder: string[],
): Pivot {
  const seen = new Set<string>();
  for (const b of buckets) seen.add(b.worker_name);
  const mapped = workerOrder.filter((n) => seen.has(n));
  const unmapped = [...seen].filter((n) => !workerOrder.includes(n)).sort();
  const series = [...mapped, ...unmapped];

  const byPeriod = new Map<string, PivotRow>();
  for (const b of buckets) {
    let row = byPeriod.get(b.period_start);
    if (!row) {
      row = { period_start: b.period_start, label: periodLabel(period, b.period_start), total: 0, byWorker: {} };
      byPeriod.set(b.period_start, row);
    }
    row.byWorker[b.worker_name] = (row.byWorker[b.worker_name] ?? 0) + b.hours;
    row.total += b.hours;
  }
  const rows = [...byPeriod.values()].sort((a, b) => a.period_start.localeCompare(b.period_start));
  return { rows, series };
}

/** Timmar med en decimal, svensk formatering. */
export function fmtHours(h: number): string {
  return h.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
