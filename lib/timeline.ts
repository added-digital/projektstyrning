/**
 * Tidslinjens gemensamma grund: mått, vecko-/datumhjälpare och
 * konverteringar mellan ISO-datum och veckoindex.
 *
 * Låg i beroendekedjan med flit — både `app/page.tsx` och
 * `lib/useTimelineDrag.ts` importerar härifrån, så inget UI-beroende får
 * krypa in i den här filen.
 */

// ---- Mått ------------------------------------------------------------------

export const WEEK_WIDTH = 36;
export const LABEL_WIDTH = 220;
export const PHASE_ROW_HEIGHT = 32;
export const HEADER_ROW_HEIGHT = 38;
/** Pixlar musen måste röra sig innan ett drag räknas som drag och inte klick. */
export const DRAG_THRESHOLD = 4;
/** Pixlar per dag när man drar med dagsprecision (⌥). */
export const DAY_WIDTH = WEEK_WIDTH / 7;

export const MONTHS_SV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Maj",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dec",
];

export const MONTHS_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

// ---- Typer -----------------------------------------------------------------

export interface WeekInfo {
  weekNum: number;
  monday: Date;
  sunday: Date;
}

export interface RangeResult {
  startIdx: number;
  endIdx: number;
}

// ---- Datumhjälpare ---------------------------------------------------------

export function isoWeeksOfYear(year: number): WeekInfo[] {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - dow);

  const weeks: WeekInfo[] = [];
  let monday = new Date(week1Mon);
  let weekNum = 1;
  while (true) {
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    weeks.push({ weekNum, monday: new Date(monday), sunday });

    const nextMon = new Date(monday);
    nextMon.setUTCDate(monday.getUTCDate() + 7);
    const nextThu = new Date(nextMon);
    nextThu.setUTCDate(nextMon.getUTCDate() + 3);
    if (nextThu.getUTCFullYear() !== year) break;
    monday = nextMon;
    weekNum++;
  }
  return weeks;
}

export function parseISODate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysToISO(iso: string, days: number): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Måndagen i den vecka datumet ligger i. */
export function snapISOToWeekStart(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const dow = (d.getUTCDay() + 6) % 7; // 0 = måndag
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Söndagen i den vecka datumet ligger i. */
export function snapISOToWeekEnd(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() + (6 - dow));
  return d.toISOString().slice(0, 10);
}

/** Antal ISO-veckor en period berör (minst 1). */
export function weekSpan(startISO: string, endISO: string): number {
  const s = parseISODate(snapISOToWeekStart(startISO));
  const e = parseISODate(snapISOToWeekStart(endISO));
  if (!s || !e) return 0;
  const diff = Math.round((e.getTime() - s.getTime()) / 604800000);
  return Math.max(1, diff + 1);
}

export function monthGroups(weeks: WeekInfo[]) {
  const groups: {
    label: string;
    start: number;
    end: number;
    monthIdx: number;
    yearOfMonth: number;
  }[] = [];
  weeks.forEach((w, i) => {
    const thu = new Date(w.monday);
    thu.setUTCDate(w.monday.getUTCDate() + 3);
    const label = MONTHS_SV[thu.getUTCMonth()];
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.end = i;
    else
      groups.push({
        label,
        start: i,
        end: i,
        monthIdx: thu.getUTCMonth(),
        yearOfMonth: thu.getUTCFullYear(),
      });
  });
  return groups;
}

export function currentWeekIndex(weeks: WeekInfo[], now: Date): number {
  const t = now.getTime();
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const endOfSun = new Date(w.sunday);
    endOfSun.setUTCHours(23, 59, 59, 999);
    if (t >= w.monday.getTime() && t <= endOfSun.getTime()) return i;
  }
  return -1;
}

/**
 * Klassificerar hur "gammal" en vecka (eller slutet av en stapel) är
 * jämfört med innevarande vecka. Används för att tona ner historik:
 * - "" = innevarande + 2 senaste veckorna är fullt synliga
 * - "is-faded-soft" = 3–6 veckor sedan
 * - "is-faded-strong" = 7+ veckor sedan
 * Om todayIdx < 0 (idag inte i visad period, t.ex. nästa år) returneras "".
 */
export function pastWeekFadeClass(weekIdx: number, todayIdx: number): string {
  if (todayIdx < 0) return "";
  const delta = todayIdx - weekIdx;
  if (delta <= 2) return "";
  if (delta <= 6) return "is-faded-soft";
  return "is-faded-strong";
}

export function dateRangeToWeeks(
  weeks: WeekInfo[],
  startDate: Date,
  endDate: Date,
): RangeResult | null {
  if (weeks.length === 0) return null;
  const yearStart = weeks[0].monday;
  const yearEnd = weeks[weeks.length - 1].sunday;
  if (endDate < yearStart) return null;
  if (startDate > yearEnd) return null;

  let startIdx = 0;
  if (startDate >= yearStart) {
    startIdx = weeks.findIndex((w) => w.sunday >= startDate);
    if (startIdx === -1) startIdx = weeks.length - 1;
  }
  let endIdx = weeks.length - 1;
  if (endDate <= yearEnd) {
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].monday <= endDate) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx < startIdx) endIdx = startIdx;
  return { startIdx, endIdx };
}

/** Samma som dateRangeToWeeks men tar ISO-strängar. */
export function isoRangeToWeeks(
  weeks: WeekInfo[],
  startISO: string,
  endISO: string,
): RangeResult | null {
  const s = parseISODate(startISO);
  const e = parseISODate(endISO);
  if (!s || !e) return null;
  return dateRangeToWeeks(weeks, s, e);
}

export function formatPanelDateRange(start: string, end: string): string {
  if (!start) return "";
  const s = new Date(start + "T00:00:00Z");
  const e = end ? new Date(end + "T00:00:00Z") : s;
  if (Number.isNaN(s.getTime())) return "";
  const sd = s.getUTCDate();
  const sm = s.getUTCMonth();
  const ed = e.getUTCDate();
  const em = e.getUTCMonth();
  if (start === (end || start)) return `${sd} ${MONTHS_SHORT[sm]}`;
  if (sm === em) return `${sd}–${ed} ${MONTHS_SHORT[sm]}`;
  return `${sd} ${MONTHS_SHORT[sm]} – ${ed} ${MONTHS_SHORT[em]}`;
}

export function fmtDay(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}
