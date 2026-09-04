import { DAILY_HOURS, type HourAllocation, type TeamMember } from "./sections";

/**
 * Beläggningsberäkning för startsidans diagram.
 *
 * Rent, testbart lager utan UI- eller filsystemsberoenden. Två saker händer
 * här:
 *
 *  1. Planerad tid: varje `HourAllocation` (totalt antal timmar över ett
 *     intervall) fördelas jämnt över intervallets vardagar. Överlappande
 *     allokeringar för samma person summeras per dag — summan får gärna
 *     överstiga både 7 och 10 timmar, det är avsett.
 *
 *  2. Sammanslagning: historik (arbetad tid, från stub eller senare Fortnox)
 *     och planerad tid (allokeringar) slås ihop till EN tidsserie per person.
 *     Dagar före idag kommer från historiken, idag och framåt från planen.
 *
 * Datum är genomgående ISO-strängar (YYYY-MM-DD) tolkade som UTC, precis som
 * i `lib/timeline.ts`.
 */

// ---- Typer -----------------------------------------------------------------

/** Var en datapunkt kommer ifrån. Låter oss skilja stub-data från riktig. */
export type OccupancySource = "stub" | "fortnox" | "allocation";

export interface OccupancyPoint {
  /** ISO YYYY-MM-DD. */
  date: string;
  hours: number;
  source: OccupancySource;
}

export interface OccupancySeries {
  person: TeamMember;
  points: OccupancyPoint[];
}

/** Målsättning för full beläggning — referenslinjen i diagrammet. */
export const TARGET_HOURS_PER_DAY = DAILY_HOURS;

// ---- Datumhjälpare ---------------------------------------------------------

const DAY_MS = 86400000;

export function parseISO(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Dagens datum som ISO, utifrån lokal tid (samma som tidslinjen gör). */
export function todayISO(now: Date = new Date()): string {
  return toISO(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso);
  if (!d) return iso;
  d.setUTCMonth(d.getUTCMonth() + months);
  return toISO(d);
}

/** Lördag eller söndag. */
export function isWeekend(iso: string): boolean {
  const d = parseISO(iso);
  if (!d) return false;
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Alla dagar i [from, to], inklusive båda ändarna. Tom lista om to < from. */
export function eachDay(from: string, to: string): string[] {
  const s = parseISO(from);
  const e = parseISO(to);
  if (!s || !e || e < s) return [];
  const n = Math.round((e.getTime() - s.getTime()) / DAY_MS) + 1;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = toISO(new Date(s.getTime() + i * DAY_MS));
  }
  return out;
}

/** Antal vardagar (mån–fre) i [from, to]. Helgdagar räknas som vardagar. */
export function countWeekdays(from: string, to: string): number {
  let n = 0;
  for (const d of eachDay(from, to)) if (!isWeekend(d)) n++;
  return n;
}

// ---- Upprepade timmar ------------------------------------------------------

/** Flyttar lördag/söndag till nästa måndag. */
export function nextWeekday(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso;
  const dow = d.getUTCDay();
  if (dow === 6) return addDays(iso, 2);
  if (dow === 0) return addDays(iso, 1);
  return iso;
}

/**
 * Datumen en upprepad allokering infaller på inom [from, to] (klippt mot
 * allokeringens egen period). Vecka: var sjunde dag från startDate.
 * Månad: samma dag i månaden; saknas dagen (31:a i en kort månad) används
 * månadens sista dag. Helg flyttas alltid fram till nästa vardag.
 */
export function recurrenceDates(a: HourAllocation, from: string, to: string): string[] {
  if (!a.repeat) return [];
  const start = parseISO(a.startDate);
  if (!start) return [];
  const lo = a.startDate > from ? a.startDate : from;
  const hi = a.endDate < to ? a.endDate : to;
  const out: string[] = [];
  const push = (iso: string) => {
    const d = nextWeekday(iso);
    if (d >= lo && d <= hi && d >= a.startDate && d <= a.endDate) out.push(d);
  };
  if (a.repeat === "week") {
    for (let d = a.startDate; d <= hi; d = addDays(d, 7)) push(d);
    return out;
  }
  const dom = start.getUTCDate();
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let guard = 0; guard < 240; guard++) {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const candidate = toISO(new Date(Date.UTC(y, m, Math.min(dom, lastDay))));
    if (candidate > hi) break;
    push(candidate);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

// ---- Planerad tid ----------------------------------------------------------

/**
 * Timmar per vardag för en allokering.
 *
 *  - mode "per_day": `hours` gäller rakt av varje vardag.
 *  - mode "total": `hours` fördelas jämnt över vardagarna. Om intervallet
 *    inte innehåller några vardagar alls (t.ex. bara en helg) fördelas de
 *    över kalenderdagarna i stället, så att de inte försvinner.
 */
export function hoursPerWeekday(a: HourAllocation): number {
  if (a.hours <= 0) return 0;
  if (a.mode === "per_day") return a.hours;
  const weekdays = countWeekdays(a.startDate, a.endDate);
  if (weekdays > 0) return a.hours / weekdays;
  const days = eachDay(a.startDate, a.endDate).length;
  return days > 0 ? a.hours / days : 0;
}

/**
 * Fördelar EN allokering över dagarna i [from, to]. Returnerar en Map
 * datum → timmar för de dagar allokeringen faktiskt bidrar till (0-dagar
 * utelämnas).
 */
export function distributeAllocation(
  a: HourAllocation,
  from: string,
  to: string,
): Map<string, number> {
  const out = new Map<string, number>();
  if (a.repeat) {
    if (a.hours > 0) for (const d of recurrenceDates(a, from, to)) out.set(d, a.hours);
    return out;
  }
  const perDay = hoursPerWeekday(a);
  if (perDay <= 0) return out;
  const spreadOverWeekends =
    a.mode === "total" && countWeekdays(a.startDate, a.endDate) === 0;
  const start = a.startDate > from ? a.startDate : from;
  const end = a.endDate < to ? a.endDate : to;
  for (const d of eachDay(start, end)) {
    if (!spreadOverWeekends && isWeekend(d)) continue;
    out.set(d, perDay);
  }
  return out;
}

/** Totalt antal timmar en allokering motsvarar (oavsett läge). */
export function allocationTotalHours(a: HourAllocation): number {
  if (a.repeat) return a.hours * recurrenceDates(a, a.startDate, a.endDate).length;
  if (a.mode === "total") return a.hours;
  return a.hours * countWeekdays(a.startDate, a.endDate);
}

/**
 * Summerar alla allokeringar per dag i [from, to]. Ingen spärr — överlappande
 * projekt får gärna ge mer än 10 h en dag.
 */
export function plannedHoursPerDay(
  allocations: readonly HourAllocation[],
  from: string,
  to: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of allocations) {
    for (const [d, h] of distributeAllocation(a, from, to)) {
      out.set(d, (out.get(d) ?? 0) + h);
    }
  }
  return out;
}

// ---- Sammanslagning --------------------------------------------------------

export interface BuildSeriesInput {
  person: TeamMember;
  from: string;
  to: string;
  /** Första dagen som räknas som "framtid" (planerad). */
  today: string;
  /** Arbetade timmar per dag från historikkällan. */
  worked: ReadonlyMap<string, number> | Record<string, number>;
  workedSource: Exclude<OccupancySource, "allocation">;
  /** Personens timallokeringar (alla, klippning sker här). */
  allocations: readonly HourAllocation[];
}

function readHours(
  src: ReadonlyMap<string, number> | Record<string, number>,
  key: string,
): number {
  const v =
    src instanceof Map ? src.get(key) : (src as Record<string, number>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Avrundar till en decimal så JSON och tooltips blir läsbara. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Bygger den sammanslagna tidsserien för en person: en punkt per dag i
 * [from, to]. Dagar före `today` hämtas från historiken, `today` och framåt
 * från allokeringarna.
 */
export function buildOccupancySeries(input: BuildSeriesInput): OccupancySeries {
  const planned = plannedHoursPerDay(
    input.allocations.filter((a) => a.member === input.person),
    input.from,
    input.to,
  );
  const points: OccupancyPoint[] = eachDay(input.from, input.to).map((date) =>
    date < input.today
      ? {
          date,
          hours: round1(readHours(input.worked, date)),
          source: input.workedSource,
        }
      : {
          date,
          hours: round1(planned.get(date) ?? 0),
          source: "allocation",
        },
  );
  return { person: input.person, points };
}

// ---- Visningsperioder ------------------------------------------------------

export type OccupancyRange = "default" | "year";

/**
 * Standardvyn: 31 dagar bakåt + två månader framåt. Helårsvyn: hela året.
 */
export function rangeFor(
  range: OccupancyRange,
  today: string,
  year: number,
): { from: string; to: string } {
  if (range === "year") {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { from: addDays(today, -31), to: addMonths(today, 2) };
}
