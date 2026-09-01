import {
  ProjectAllocation,
  TeamMember,
  WEEKLY_CAPACITY,
  type Project,
} from "./sections";

/**
 * Beläggningsberäkning: summerar timmar/vecka per teammedlem över alla aktiva
 * projekt vars datumspann överlappar varje ISO-vecka.
 *
 * Räknade statusar: "active" och "lead" — leads är potentiella projekt vars
 * påverkan på planeringen vi vill kunna se. Paused/done/archived påverkar
 * inte siffrorna.
 */

export interface ProjectRowLike {
  customer: string;
  customerSlug: string;
  project: Project;
}

export interface WeekRange {
  monday: Date;
  sunday: Date;
}

export interface WeekBookingItem {
  customer: string;
  customerSlug: string;
  projectId: string;
  projectName: string;
  hours: number;
}

export interface WeekBooking {
  /** Totala bokade timmar denna vecka. */
  hours: number;
  /** Uppdelning per projekt — för tooltips/expand. */
  byProject: WeekBookingItem[];
}

/** Är ett projekt "aktivt" så att dess allokeringar ska räknas?
 * Både "active" och "lead" räknas — leads visas i arket som potentiell
 * planering och vi vill se hur de skulle påverka beläggningen. */
function isCountedTowardLoad(project: Project): boolean {
  const status = project.status ?? "active";
  return status === "active" || status === "lead";
}

/** Inklusiv overlap mellan en ISO-vecka och en allokerings tidsperiod. */
function weekOverlapsAllocation(
  weekMonday: Date,
  weekSunday: Date,
  allocStart: string,
  allocEnd: string,
): boolean {
  if (!allocStart || !allocEnd) return false;
  const as = new Date(allocStart + "T00:00:00Z").getTime();
  const ae = new Date(allocEnd + "T00:00:00Z").getTime();
  if (!Number.isFinite(as) || !Number.isFinite(ae)) return false;
  const ws = weekMonday.getTime();
  const we = weekSunday.getTime();
  return ws <= ae && we >= as;
}

/**
 * Räknar bokade timmar per teammedlem för en lista veckor.
 *
 * Använder ALLOKERINGENS egna start/end-datum, frikopplat från projektets
 * tidsperiod. Det gör att flera personer kan ha olika perioder på samma
 * projekt utan att blanda ihop sig.
 *
 * Returnerar en Map där varje värde är en array i samma ordning som `weeks`.
 */
export function computeWeeklyBookings(
  weeks: readonly WeekRange[],
  rows: readonly ProjectRowLike[],
): Map<TeamMember, WeekBooking[]> {
  const result = new Map<TeamMember, WeekBooking[]>();

  function ensure(member: TeamMember): WeekBooking[] {
    let arr = result.get(member);
    if (!arr) {
      arr = weeks.map(() => ({ hours: 0, byProject: [] }));
      result.set(member, arr);
    }
    return arr;
  }

  for (const row of rows) {
    const p = row.project;
    if (!isCountedTowardLoad(p)) continue;
    const allocs: ProjectAllocation[] = p.allocations ?? [];
    if (allocs.length === 0) continue;
    for (const a of allocs) {
      if (!a.member || a.hoursPerWeek <= 0) continue;
      for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        if (!weekOverlapsAllocation(w.monday, w.sunday, a.startDate, a.endDate)) {
          continue;
        }
        const arr = ensure(a.member);
        arr[i].hours += a.hoursPerWeek;
        arr[i].byProject.push({
          customer: row.customer,
          customerSlug: row.customerSlug,
          projectId: p.id,
          projectName: p.name,
          hours: a.hoursPerWeek,
        });
      }
    }
  }
  return result;
}

/**
 * Tillgängliga timmar nästa N veckor (från och med startWeekIdx).
 * Per vecka tas max(0, WEEKLY_CAPACITY − bokat); överbokning räknas alltså
 * inte som "negativ tillgänglig tid".
 */
export function availableNextWeeks(
  bookings: WeekBooking[] | undefined,
  startWeekIdx: number,
  numWeeks: number,
): number {
  if (!bookings) return WEEKLY_CAPACITY * Math.max(0, numWeeks);
  let avail = 0;
  const end = Math.min(bookings.length, startWeekIdx + numWeeks);
  for (let i = Math.max(0, startWeekIdx); i < end; i++) {
    avail += Math.max(0, WEEKLY_CAPACITY - bookings[i].hours);
  }
  // Veckor bortom året: anta full kapacitet (mest naturliga default).
  const missingWeeks =
    Math.max(0, numWeeks) - Math.max(0, end - Math.max(0, startWeekIdx));
  avail += missingWeeks * WEEKLY_CAPACITY;
  return avail;
}

/** Färg/severitet för en cell utifrån bokade timmar. */
export type LoadLevel = "empty" | "ok" | "tight" | "over";

export function loadLevel(hours: number): LoadLevel {
  if (hours <= 0) return "empty";
  const pct = hours / WEEKLY_CAPACITY;
  if (pct <= 0.8) return "ok";
  if (pct <= 1.0) return "tight";
  return "over";
}

/** Hjälpare: lista aktiva projekt som en medlem är allokerad på. */
export function activeProjectsForMember(
  rows: readonly ProjectRowLike[],
  member: TeamMember,
): ProjectRowLike[] {
  return rows.filter((r) => {
    if (!isCountedTowardLoad(r.project)) return false;
    return (r.project.allocations ?? []).some((a) => a.member === member);
  });
}

// ---- Tid: enheter och formatering -----------------------------------------

/** Visningsenhet för allokeringar: timmar per vecka eller andel av kapacitet. */
export type HoursUnit = "h" | "%";

function formatNumberSv(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

export function formatHours(hours: number, unit: HoursUnit): string {
  if (unit === "%") return `${Math.round((hours / WEEKLY_CAPACITY) * 100)}%`;
  return `${formatNumberSv(hours)}h/v`;
}

/** Kompakt form för chips och knappar: "14h" / "40%". */
export function formatHoursCompact(hours: number, unit: HoursUnit): string {
  if (unit === "%") return `${Math.round((hours / WEEKLY_CAPACITY) * 100)}%`;
  return `${formatNumberSv(hours)}h`;
}

/** Bara siffran, i aktuell enhet — för redigerbara fält. */
export function hoursInputValue(hours: number, unit: HoursUnit): string {
  if (hours <= 0) return "";
  if (unit === "%") return String(Math.round((hours / WEEKLY_CAPACITY) * 100));
  return formatNumberSv(hours);
}

/** Tolkar inmatning i aktuell enhet. Returnerar null vid skräp. */
export function parseHoursInput(raw: string, unit: HoursUnit): number | null {
  const cleaned = raw.replace("%", "").replace(",", ".").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  if (unit === "%") return Math.round((n / 100) * WEEKLY_CAPACITY * 2) / 2;
  return Math.round(n * 2) / 2;
}

/** Snabbval i allokerings-popovern — 10/20/40/60/100 % av en arbetsvecka. */
export const HOURS_PRESETS = [3.5, 7, 14, 21, WEEKLY_CAPACITY];
