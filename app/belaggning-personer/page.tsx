"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import {
  newCapacityReservation,
  isoWeekString,
  type CapacityReservation,
  type CustomerData,
  type HourAllocation,
  type RepeatUnit,
  type TeamMember,
} from "@/lib/sections";
import { expectedReserveHours } from "@/lib/capacity";
import {
  eachDay,
  distributeAllocation,
  hoursPerWeekday,
  isWeekend,
  rangeFor,
  recurrenceDates,
  TARGET_HOURS_PER_DAY,
  todayISO,
  type OccupancySource,
} from "@/lib/belaggning";
import { fetchBelaggning, type BelaggningData } from "@/lib/belaggningClient";
import { useBelaggningCustomers } from "@/lib/useBelaggningCustomers";
import { MONTHS_SV } from "@/lib/timeline";
import { DISPLAY_MEMBERS, MEMBER_COLORS } from "@/lib/teamVisuals";
import { BelaggningAllocPopover } from "@/components/BelaggningAllocPopover";
import { MainNav } from "@/components/MainNav";
import { useBarDrag, type ColRange } from "@/lib/useBarDrag";
import { showToast } from "@/components/Toast";

/**
 * Beläggning per person: samma data som diagrammet på `/`, men som ett
 * rutnät. Namnen till vänster; under varje namn en rad per projekt med
 * allokeringarna som staplar. Personraden visar timmar per vardag —
 * historik (stub, senare Fortnox) bakåt i tiden, planerad tid framåt.
 *
 * X-axeln är vardagar (helger visas inte, precis som i diagrammet).
 */

const LABEL_W = 200;
/** Samma kolumnbredd för alla dagar — förflutna dagar smalnar inte av. */
const DAY_W = 36;
const ROW_H = 30;
const PERSON_ROW_H = 36;

interface ProjectRow {
  customerSlug: string;
  customer: string;
  projectId: string;
  projectName: string;
  /** Allokeringar fördelade på underrader så att inga två överlappar. */
  lanes: HourAllocation[][];
}

interface DayCell {
  hours: number;
  source: OccupancySource | undefined;
}

interface ReserveRow {
  customerSlug: string;
  customer: string;
  projectId: string;
  projectName: string;
  reservation: CapacityReservation;
}

function isPlannable(status: string | undefined): boolean {
  const s = status ?? "active";
  return s === "active" || s === "lead";
}

function formatHoursSv(h: number): string {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}

/** Greedy lane-packning: en allokering hamnar på första raden där den ryms. */
function packLanes(allocs: HourAllocation[]): HourAllocation[][] {
  const sorted = allocs
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lanes: HourAllocation[][] = [];
  for (const a of sorted) {
    let placed = false;
    for (const lane of lanes) {
      const last = lane[lane.length - 1];
      if (last.endDate < a.startDate) {
        lane.push(a);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([a]);
  }
  return lanes;
}

function loadClass(hours: number): string {
  if (hours <= 0) return "empty";
  if (hours < TARGET_HOURS_PER_DAY - 0.05) return "ok";
  if (hours <= TARGET_HOURS_PER_DAY + 0.05) return "full";
  return "over";
}

function barLabel(a: HourAllocation): string {
  if (a.estimateMode === "range" && a.lowHours != null && a.highHours != null) {
    return `${formatHoursSv(a.lowHours)}–${formatHoursSv(a.highHours)}h · ≈${formatHoursSv(a.hours)}h`;
  }
  if (a.mode === "per_day") return `${formatHoursSv(a.hours)}h`;
  return `${formatHoursSv(a.hours)}h totalt · ≈${formatHoursSv(hoursPerWeekday(a))}h/dag`;
}

export default function BelaggningPersonerPage() {
  const {
    customers,
    loading,
    error,
    refreshing,
    epoch,
    load,
    saveHourAllocation,
    removeHourAllocation,
    saveCapacityReservation,
    removeCapacityReservation,
    createCustomer,
    createProject,
  } = useBelaggningCustomers();

  const today = useMemo(() => todayISO(), []);
  const year = Number(today.slice(0, 4));
  // Hela året med dagens kolumn centrerad — eller, med "Dölj förflutet",
  // från idag och framåt. Valet sparas per webbläsare.
  const [hidePast, setHidePast] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("bpp-hide-past") === "1") setHidePast(true);
    } catch {}
  }, []);
  function toggleHidePast() {
    setHidePast((v) => {
      try { window.localStorage.setItem("bpp-hide-past", v ? "0" : "1"); } catch {}
      return !v;
    });
  }
  const { from, to } = useMemo(() => {
    const full = rangeFor("year", today, year);
    return hidePast ? { from: today, to: full.to } : full;
  }, [today, year, hidePast]);
  const [series, setSeries] = useState<BelaggningData | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [popup, setPopup] = useState<{
    person: TeamMember;
    date?: string;
    editId?: string;
    repeat?: RepeatUnit;
  } | null>(null);
  const [reservePopup, setReservePopup] = useState<ReserveRow | "new" | null>(null);
  const [createPopup, setCreatePopup] = useState<
    { kind: "customer" } | { kind: "project"; customerSlug?: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    fetchBelaggning(from, to)
      .then((d) => {
        if (cancelled) return;
        setSeries(d);
        setSeriesError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSeriesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, epoch]);

  // ---- Kolumner: bara vardagar ----
  const days = useMemo(
    () => eachDay(from, to).filter((d) => !isWeekend(d)),
    [from, to],
  );
  const colOf = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d, i));
    return m;
  }, [days]);
  const months = useMemo(() => {
    const out: { label: string; start: number; end: number }[] = [];
    days.forEach((d, i) => {
      const label = MONTHS_SV[Number(d.slice(5, 7)) - 1];
      const last = out[out.length - 1];
      if (last && last.label === label) last.end = i;
      else out.push({ label, start: i, end: i });
    });
    return out;
  }, [days]);
  const weeks = useMemo(() => {
    const out: { label: string; start: number; end: number }[] = [];
    days.forEach((d, i) => {
      const isoWeek = isoWeekString(new Date(`${d}T12:00:00`));
      const label = `v${Number(isoWeek.slice(-2))}`;
      const last = out[out.length - 1];
      if (last && last.label === label) last.end = i;
      else out.push({ label, start: i, end: i });
    });
    return out;
  }, [days]);
  const todayCol = useMemo(() => {
    // Infaller idag på en helg pekar markeringen på nästa vardag.
    let i = days.findIndex((d) => d >= today);
    if (i < 0) i = days.length; // idag ligger bortom perioden
    return i;
  }, [days, today]);

  /** Första och sista vardagskolumnen en allokering täcker, eller null. */
  function colsFor(a: HourAllocation): { start: number; end: number } | null {
    let start = -1;
    let end = -1;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d < a.startDate) continue;
      if (d > a.endDate) break;
      if (start < 0) start = i;
      end = i;
    }
    return start < 0 ? null : { start, end };
  }
  function colsForRange(startDate: string, endDate: string) {
    return colsFor({ startDate, endDate } as HourAllocation);
  }

  // ---- Data per person ----
  const dayCells = useMemo(() => {
    const m = new Map<TeamMember, Map<string, DayCell>>();
    for (const s of series?.series ?? []) {
      const inner = new Map<string, DayCell>();
      for (const p of s.points) inner.set(p.date, { hours: p.hours, source: p.source });
      m.set(s.person, inner);
    }
    return m;
  }, [series]);

  const projectRows = useMemo(() => {
    const byMember = new Map<TeamMember, ProjectRow[]>();
    for (const m of DISPLAY_MEMBERS) byMember.set(m, []);
    for (const [slug, c] of Object.entries(customers)) {
      for (const p of c.projects) {
        if (!isPlannable(p.status)) continue;
        const allocs = p.hourAllocations ?? [];
        if (allocs.length === 0) continue;
        for (const m of DISPLAY_MEMBERS) {
          const mine = allocs.filter((a) => a.member === m);
          if (mine.length === 0) continue;
          byMember.get(m)!.push({
            customerSlug: slug,
            customer: c.client || slug,
            projectId: p.id,
            projectName: p.name || "(utan namn)",
            lanes: packLanes(mine),
          });
        }
      }
    }
    for (const rows of byMember.values()) {
      rows.sort(
        (a, b) =>
          a.customer.localeCompare(b.customer, "sv") ||
          a.projectName.localeCompare(b.projectName, "sv"),
      );
    }
    return byMember;
  }, [customers]);

  /** Högsta möjliga planerade belastning per vardag. */
  const riskDayCells = useMemo(() => {
    const result = new Map<TeamMember, Map<string, number>>();
    for (const member of DISPLAY_MEMBERS) result.set(member, new Map());
    for (const customer of Object.values(customers)) {
      for (const project of customer.projects) {
        if (!isPlannable(project.status)) continue;
        for (const allocation of project.hourAllocations ?? []) {
          const maxHours = allocation.estimateMode === "range"
            ? allocation.highHours ?? allocation.hours
            : allocation.hours;
          for (const [date, hours] of distributeAllocation({ ...allocation, hours: maxHours }, from, to)) {
            const personDays = result.get(allocation.member)!;
            personDays.set(date, (personDays.get(date) ?? 0) + hours);
          }
        }
      }
    }
    return result;
  }, [customers, from, to]);

  const reserveRows = useMemo(() => {
    const rows: ReserveRow[] = [];
    for (const [slug, c] of Object.entries(customers)) {
      for (const p of c.projects) {
        if (!isPlannable(p.status)) continue;
        for (const reservation of p.capacityReservations ?? []) rows.push({
          customerSlug: slug,
          customer: c.client || slug,
          projectId: p.id,
          projectName: p.name || "(utan namn)",
          reservation,
        });
      }
    }
    return rows.sort((a, b) => a.reservation.startDate.localeCompare(b.reservation.startDate));
  }, [customers]);

  const visibleReserve = useMemo(() => reserveRows.reduce((sum, row) => {
    if (row.reservation.endDate < from || row.reservation.startDate > to) return sum;
    return sum + expectedReserveHours(row.reservation.minHours, row.reservation.maxHours, row.reservation.probability);
  }, 0), [reserveRows, from, to]);

  // Scrolla fram till idag när vyn laddats.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef<string>("");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || todayCol >= days.length) return;
    const key = `${from}:${to}`;
    if (scrolledRef.current === key) return;
    const xBeforeToday = Math.min(todayCol, days.length) * DAY_W;

    // Etikettkolumnen är sticky och tar LABEL_W av viewporten; centrera
    // dagens kolumn i den yta som återstår. Elementet kan sakna bredd när
    // effekten körs (t.ex. dold flik), så vi väntar in första layouten.
    function center(): boolean {
      if (!el || el.clientWidth === 0) return false;
      const x = xBeforeToday - (el.clientWidth - LABEL_W) / 2;
      el.scrollTo({ left: Math.max(0, x) });
      scrolledRef.current = key;
      return true;
    }
    if (center()) return;
    const ro = new ResizeObserver(() => {
      if (center()) ro.disconnect();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, todayCol, days.length, from, to]);

  const dayWidths = days.map(() => DAY_W);
  const daysWidth = dayWidths.reduce((sum, width) => sum + width, 0);
  const cssVars = {
    ["--label-w" as string]: `${LABEL_W}px`,
    ["--day-columns" as string]: dayWidths.map((width) => `${width}px`).join(" "),
    ["--days-width" as string]: `${daysWidth}px`,
    ["--row-h" as string]: `${ROW_H}px`,
    ["--person-row-h" as string]: `${PERSON_ROW_H}px`,
  } as React.CSSProperties;

  return (
    <div className="belaggning-page">
      <div className="page-toolbar">
        <div className="page-toolbar-inner">
          <button
            type="button"
            className="icon-btn toolbar-refresh"
            onClick={() => load("silent")}
            title="Ladda om data från servern"
            aria-label="Ladda om data"
          >
            <RefreshCw
              size={13}
              strokeWidth={2.25}
              aria-hidden
              className={refreshing ? "spin" : ""}
            />
          </button>

          <h1 className="bpp-title">Per person</h1>

          <button
            type="button"
            className={`filter-pill ${hidePast ? "on" : ""}`}
            aria-pressed={hidePast}
            onClick={toggleHidePast}
            title={hidePast ? "Visa även förflutna dagar" : "Visa bara från idag och framåt"}
          >
            Dölj förflutet
          </button>

          <div className="toolbar-spacer" />
          {visibleReserve > 0 && <span className="bpp-reserve-total" title="Ansvarig reserv som ännu inte räknas som bokad tid">Reserv ≈{formatHoursSv(visibleReserve)}h</span>}
          <button type="button" className="btn btn-mute toolbar-btn" onClick={() => setCreatePopup({ kind: "customer" })}>
            <Plus size={13} aria-hidden /> Kund
          </button>
          <button type="button" className="btn btn-mute toolbar-btn" onClick={() => setCreatePopup({ kind: "project" })}>
            <Plus size={13} aria-hidden /> Projekt
          </button>
          <button type="button" className="btn btn-mute toolbar-btn" onClick={() => setPopup({ person: DISPLAY_MEMBERS[0], repeat: "week" })} title="Samma antal timmar varje vecka eller månad">
            <Plus size={13} aria-hidden /> Upprepade timmar
          </button>
          <button type="button" className="btn toolbar-btn" onClick={() => setReservePopup("new")}>
            <Plus size={13} aria-hidden /> Reserv
          </button>

          <MainNav />
        </div>
      </div>

      <div className="bpp-main">
        {loading ? (
          <div className="empty-state large">Hämtar data…</div>
        ) : error || seriesError ? (
          <div className="empty-state large">
            Kunde inte hämta data: {error ?? seriesError}
          </div>
        ) : (
          <div className="bpp-scroll" ref={scrollRef} style={cssVars}>
            {/* Månader */}
            <div className="bpp-row bpp-row-month">
              <div className="bpp-label bpp-label-head">
                <span className="bpp-year">{year}</span>
              </div>
              <div className="bpp-cells">
                {months.map((g) => (
                  <span
                    key={`m-${g.start}`}
                    className="bpp-month"
                    style={{ gridColumn: `${g.start + 1} / ${g.end + 2}` }}
                  >
                    {g.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Veckor */}
            <div className="bpp-row bpp-row-weeks">
              <div className="bpp-label bpp-label-head" />
              <div className="bpp-cells">
                {weeks.map((g) => (
                  <span
                    key={`w-${g.start}`}
                    className="bpp-week"
                    style={{ gridColumn: `${g.start + 1} / ${g.end + 2}` }}
                  >
                    {g.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Dagar */}
            <div className="bpp-row bpp-row-days">
              <div className="bpp-label bpp-label-head">
                <span className="bpp-head-hint">h / vardag</span>
              </div>
              <div className="bpp-cells">
                {days.map((d, i) => {
                  const dow = new Date(d + "T00:00:00Z").getUTCDay();
                  return (
                    <span
                      key={d}
                      className={`bpp-day ${dow === 1 ? "is-monday" : ""} ${
                        i === todayCol ? "is-today" : i < todayCol ? "is-past" : ""
                      }`}
                      title={d}
                    >
                      {Number(d.slice(8, 10))}
                    </span>
                  );
                })}
              </div>
            </div>

            {DISPLAY_MEMBERS.map((m) => {
              const cells = dayCells.get(m);
              const rows = projectRows.get(m) ?? [];
              const myReserves = reserveRows.filter((r) => r.reservation.member === m);
              const color = MEMBER_COLORS[m];
              return (
                <div key={m} className="bpp-person">
                  <div className="bpp-row bpp-row-person">
                    <div className="bpp-label bpp-label-person">
                      <button
                        type="button"
                        className="bpp-name"
                        onClick={() => setPopup({ person: m })}
                        title={`Planera tid för ${m}`}
                      >
                        <span
                          className="belaggning-swatch"
                          style={{ background: color }}
                          aria-hidden
                        />
                        {m}
                      </button>
                    </div>
                    <div className="bpp-cells">
                      {days.map((d, i) => {
                        const c = cells?.get(d);
                        const h = c?.hours ?? 0;
                        const riskHours = i < todayCol ? h : riskDayCells.get(m)?.get(d) ?? h;
                        const hasRisk = riskHours > h + 0.05;
                        const past = i < todayCol;
                        return (
                          <button
                            type="button"
                            key={d}
                            className={`bpp-sum ${loadClass(h)} ${
                              past ? "is-past" : ""
                            } ${i === todayCol ? "is-today" : ""}`}
                            title={`${d} · ${formatHoursSv(h)} h${
                              c?.source === "allocation"
                                ? " planerat"
                                : c?.source
                                  ? ` (${c.source})`
                                  : ""
                            }${hasRisk ? ` · max ${formatHoursSv(riskHours)} h` : ""}`}
                            onClick={() =>
                              setPopup({ person: m, date: past ? undefined : d })
                            }
                          >
                            {h > 0 ? formatHoursSv(h) : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {myReserves.map((row) => {
                    const cols = colsForRange(row.reservation.startDate, row.reservation.endDate);
                    if (!cols) return null;
                    const expected = expectedReserveHours(row.reservation.minHours, row.reservation.maxHours, row.reservation.probability);
                    return <div className="bpp-row bpp-row-reserve" key={row.reservation.id}>
                      <button type="button" className="bpp-label bpp-label-reserve" onClick={() => setReservePopup(row)}>
                        <span className="bpp-project-name">{row.customer}</span>
                      </button>
                      <div className="bpp-cells bpp-cells-bars">
                        <DraggableBar
                          cols={cols}
                          maxCol={days.length - 1}
                          scrollEl={scrollRef.current}
                          className="bpp-reserve-bar"
                          title={`${row.reservation.comment}\nAnsvarig: ${m}\nEj bokad · prognos ${formatHoursSv(expected)}h · max ${formatHoursSv(row.reservation.maxHours)}h\nDra för att flytta, dra i kanten för att ändra längd`}
                          onOpen={() => setReservePopup(row)}
                          onCommit={(next) => {
                            saveCapacityReservation(row.customerSlug, row.projectId, {
                              ...row.reservation,
                              startDate: days[next.start],
                              endDate: days[next.end],
                            });
                            showToast(`Reserv ${row.customer}: ${days[next.start]} – ${days[next.end]}`);
                          }}
                        >
                          {formatHoursSv(row.reservation.minHours)}–{formatHoursSv(row.reservation.maxHours)}h · ≈{formatHoursSv(expected)}h
                        </DraggableBar>
                      </div>
                    </div>;
                  })}

                  {rows.length === 0 && myReserves.length === 0 && (
                    <div className="bpp-row bpp-row-empty">
                      <div className="bpp-label">
                        <span className="bpp-empty-hint">
                          Inget planerat än
                        </span>
                      </div>
                      <div className="bpp-cells" />
                    </div>
                  )}

                  {rows.map((r) =>
                    r.lanes.map((lane, laneIdx) => (
                      <div
                        key={`${r.customerSlug}:${r.projectId}:${laneIdx}`}
                        className={`bpp-row bpp-row-project ${
                          laneIdx > 0 ? "is-lane" : ""
                        }`}
                      >
                        <div className="bpp-label bpp-label-project">
                          {laneIdx === 0 && (
                            <span className="bpp-project-name">
                              {r.customer}
                            </span>
                          )}
                        </div>
                        <div className="bpp-cells bpp-cells-bars">
                          {lane.map((a) => {
                            if (a.repeat) {
                              // Upprepade timmar: ett litet block per tillfälle.
                              return recurrenceDates(a, from, to).map((d) => {
                                const c = colOf.get(d);
                                if (c === undefined) return null;
                                return (
                                  <button
                                    type="button"
                                    key={`${a.id}:${d}`}
                                    className="bpp-bar is-repeat"
                                    style={{
                                      gridColumn: `${c + 1} / ${c + 2}`,
                                      background: `${color}14`,
                                      borderColor: `${color}80`,
                                      ["--member-color" as string]: color,
                                    }}
                                    title={`${r.customer} · ${r.projectName}\n${formatHoursSv(a.hours)} h ${a.repeat === "week" ? "varje vecka" : "varje månad"} · ${a.startDate} – ${a.endDate}${a.comment ? `\n${a.comment}` : ""}`}
                                    onClick={() => setPopup({ person: m, editId: a.id })}
                                  >
                                    <span className="bpp-bar-text">{formatHoursSv(a.hours)}h</span>
                                  </button>
                                );
                              });
                            }
                            const cols = colsFor(a);
                            if (!cols) return null;
                            const project = customers[r.customerSlug]?.projects.find((p) => p.id === r.projectId);
                            return (
                              <DraggableBar
                                key={a.id}
                                cols={cols}
                                maxCol={days.length - 1}
                                scrollEl={scrollRef.current}
                                className={`bpp-bar ${a.estimateMode === "range" ? "is-range" : ""}`}
                                style={{
                                  background: `${color}14`,
                                  borderColor: `${color}80`,
                                  ["--member-color" as string]: color,
                                }}
                                title={`${r.customer} · ${r.projectName}\n${barLabel(a)} · ${a.startDate} – ${a.endDate}${
                                  a.comment ? `\n${a.comment}` : ""
                                }\nDra för att flytta, dra i kanten för att ändra längd`}
                                onOpen={() => setPopup({ person: m, editId: a.id })}
                                onCommit={(next) => {
                                  saveHourAllocation({
                                    customerSlug: r.customerSlug,
                                    projectId: r.projectId,
                                    pricingType: project?.pricingType ?? "avtalade_timmar",
                                    allocation: { ...a, startDate: days[next.start], endDate: days[next.end] },
                                    replace: { customerSlug: r.customerSlug, projectId: r.projectId, allocationId: a.id },
                                  });
                                  showToast(`${r.customer}: ${days[next.start]} – ${days[next.end]}`);
                                }}
                              >
                                <span className="bpp-bar-text">
                                  {barLabel(a)}
                                </span>
                              </DraggableBar>
                            );
                          })}
                        </div>
                      </div>
                    )),
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {popup && (
        <BelaggningAllocPopover
          person={popup.person}
          initialDate={popup.date}
          editAllocationId={popup.editId}
          initialRepeat={popup.repeat}
          customers={customers}
          onClose={() => setPopup(null)}
          onSave={(draft) => {
            saveHourAllocation(draft);
            setPopup(null);
            showToast(
              draft.replace
                ? `Uppdaterade planerad tid för ${draft.allocation.member}`
                : `Planerade ${draft.allocation.hours} h för ${draft.allocation.member}`,
            );
          }}
          onRemove={removeHourAllocation}
        />
      )}
      {reservePopup && (
        <CapacityReservationPopover
          customers={customers}
          initial={reservePopup === "new" ? null : reservePopup}
          defaultStart={today}
          defaultEnd={to}
          onClose={() => setReservePopup(null)}
          onSave={(slug, projectId, reservation) => {
            saveCapacityReservation(slug, projectId, reservation);
            setReservePopup(null);
            showToast("Kapacitetsreserven sparades");
          }}
          onRemove={reservePopup === "new" ? undefined : () => {
            removeCapacityReservation(reservePopup.customerSlug, reservePopup.projectId, reservePopup.reservation.id);
            setReservePopup(null);
          }}
        />
      )}
      {createPopup && (
        <CreateCustomerProjectPopover
          key={`${createPopup.kind}:${createPopup.kind === "project" ? createPopup.customerSlug ?? "" : ""}`}
          mode={createPopup.kind}
          customers={customers}
          initialCustomerSlug={createPopup.kind === "project" ? createPopup.customerSlug : undefined}
          onClose={() => setCreatePopup(null)}
          onCreateCustomer={async (name) => {
            const slug = await createCustomer(name);
            if (slug) {
              showToast("Kunden skapades");
              setCreatePopup({ kind: "project", customerSlug: slug });
            }
          }}
          onCreateProject={async (slug, name) => {
            if (await createProject(slug, name)) {
              showToast("Projektet skapades");
              setCreatePopup(null);
            }
          }}
        />
      )}
    </div>
  );
}

function CreateCustomerProjectPopover({ mode, customers, initialCustomerSlug, onClose, onCreateCustomer, onCreateProject }: {
  mode: "customer" | "project";
  customers: Record<string, CustomerData>;
  initialCustomerSlug?: string;
  onClose: () => void;
  onCreateCustomer: (name: string) => Promise<void>;
  onCreateProject: (slug: string, name: string) => Promise<void>;
}) {
  const slugs = Object.keys(customers).sort((a, b) => (customers[a].client || a).localeCompare(customers[b].client || b, "sv"));
  const [slug, setSlug] = useState(initialCustomerSlug ?? slugs[0] ?? "");
  // Om den nyss skapade kunden inte hunnit in i listan vid första render:
  // följ med när den dyker upp.
  useEffect(() => {
    if (initialCustomerSlug && customers[initialCustomerSlug]) setSlug(initialCustomerSlug);
  }, [initialCustomerSlug, customers]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = async () => {
    if (!name.trim() || saving || (mode === "project" && !slug)) return;
    setSaving(true);
    if (mode === "customer") await onCreateCustomer(name);
    else await onCreateProject(slug, name);
    setSaving(false);
  };
  return <>
    <div className="belaggning-popover-backdrop" onClick={onClose} />
    <div className="bpp-create-popover" role="dialog" aria-modal="true" aria-label={mode === "customer" ? "Ny kund" : "Nytt projekt"}>
      <div className="bpp-reserve-popover-head"><strong>{mode === "customer" ? "Ny kund" : "Nytt projekt"}</strong><button type="button" onClick={onClose} aria-label="Stäng"><X size={15} /></button></div>
      {mode === "project" && <label>Kund<select value={slug} onChange={(e) => setSlug(e.target.value)}>{slugs.map((s) => <option key={s} value={s}>{customers[s].client || s}</option>)}</select></label>}
      <label>{mode === "customer" ? "Namn" : "Projektnamn"}<input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} /></label>
      <div className="bpp-create-actions"><button type="button" className="primary" disabled={!name.trim() || saving || (mode === "project" && !slug)} onClick={() => void submit()}>{saving ? "Skapar…" : "Skapa"}</button></div>
    </div>
  </>;
}

function CapacityReservationPopover({ customers, initial, defaultStart, defaultEnd, onClose, onSave, onRemove }: {
  customers: Record<string, CustomerData>;
  initial: ReserveRow | null;
  defaultStart: string;
  defaultEnd: string;
  onClose: () => void;
  onSave: (slug: string, projectId: string, reservation: CapacityReservation) => void;
  onRemove?: () => void;
}) {
  const slugs = Object.keys(customers).filter((slug) => customers[slug].projects.some((p) => isPlannable(p.status)));
  const [slug, setSlug] = useState(initial?.customerSlug ?? slugs[0] ?? "");
  const projects = customers[slug]?.projects.filter((p) => isPlannable(p.status)) ?? [];
  const [projectId, setProjectId] = useState(initial?.projectId ?? projects[0]?.id ?? "");
  const [draft, setDraft] = useState<CapacityReservation>(() => initial?.reservation ?? newCapacityReservation(defaultStart, defaultEnd));
  const expected = expectedReserveHours(draft.minHours, draft.maxHours, draft.probability);
  const patchNumber = (key: "minHours" | "maxHours", raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    setDraft((d) => key === "minHours" ? { ...d, minHours: n, maxHours: Math.max(n, d.maxHours) } : { ...d, maxHours: Math.max(n, d.minHours) });
  };
  return <>
    <div className="belaggning-popover-backdrop" onClick={onClose} />
    <div className="bpp-reserve-popover" role="dialog" aria-modal="true" aria-label="Kapacitetsreserv">
      <div className="bpp-reserve-popover-head"><strong>{initial ? "Redigera reserv" : "Ny reserv"}</strong><button type="button" onClick={onClose} aria-label="Stäng"><X size={15} /></button></div>
      <label>Kund<select value={slug} disabled={!!initial} onChange={(e) => { const next = e.target.value; setSlug(next); setProjectId(customers[next]?.projects.find((p) => isPlannable(p.status))?.id ?? ""); }}>{slugs.map((s) => <option key={s} value={s}>{customers[s].client || s}</option>)}</select></label>
      <label>Projekt<select value={projectId} disabled={!!initial} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name || "(utan namn)"}</option>)}</select></label>
      <label>Benämning<input value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} /></label>
      <label>Ansvarig<select value={draft.member} onChange={(e) => setDraft({ ...draft, member: e.target.value as TeamMember })}>{DISPLAY_MEMBERS.map((member) => <option key={member} value={member}>{member}</option>)}</select></label>
      <div className="bpp-reserve-fields"><label>Min (h)<input inputMode="decimal" defaultValue={draft.minHours} onBlur={(e) => patchNumber("minHours", e.target.value)} /></label><label>Max (h)<input inputMode="decimal" defaultValue={draft.maxHours} onBlur={(e) => patchNumber("maxHours", e.target.value)} /></label></div>
      <label>Sannolikhet<select value={draft.probability} onChange={(e) => setDraft({ ...draft, probability: Number(e.target.value) })}><option value={0.25}>Låg · 25%</option><option value={0.5}>Trolig · 50%</option><option value={0.75}>Hög · 75%</option><option value={1}>Säker · 100%</option></select></label>
      <div className="bpp-reserve-fields"><label>Från<input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></label><label>Till<input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></label></div>
      <div className="bpp-reserve-result">Prognos ≈{formatHoursSv(expected)}h · max {formatHoursSv(draft.maxHours)}h</div>
      <div className="bpp-reserve-actions">{onRemove && <button type="button" className="danger" onClick={onRemove}>Ta bort</button>}<span /><button type="button" className="primary" disabled={!slug || !projectId || !draft.startDate || draft.endDate < draft.startDate} onClick={() => onSave(slug, projectId, draft)}>Spara</button></div>
    </div>
  </>;
}


/**
 * Stapel som kan dras (flytta) eller dras i kanterna (ändra längd).
 * Ett klick utan förflyttning öppnar popupen som förut; under draget
 * ritas stapeln på förhandsvisningens kolumner och sparas när den släpps.
 */
function DraggableBar({
  cols,
  maxCol,
  scrollEl,
  className,
  style,
  title,
  onOpen,
  onCommit,
  children,
}: {
  cols: ColRange;
  maxCol: number;
  scrollEl: HTMLElement | null;
  className: string;
  style?: React.CSSProperties;
  title: string;
  onOpen: () => void;
  onCommit: (next: ColRange) => void;
  children: React.ReactNode;
}) {
  const drag = useBarDrag({ cols, dayWidth: DAY_W, maxCol, scrollEl, onCommit });
  const shown = drag.preview ?? cols;
  return (
    <button
      type="button"
      className={`${className} ${drag.dragging ? "is-dragging" : ""}`}
      style={{ ...style, gridColumn: `${shown.start + 1} / ${shown.end + 2}` }}
      title={title}
      onPointerDown={(e) => drag.startDrag(e, "move")}
      onClick={() => {
        if (!drag.consumeClick()) onOpen();
      }}
    >
      <span
        className="bpp-bar-handle left"
        aria-hidden
        onPointerDown={(e) => drag.startDrag(e, "resize-left")}
      />
      {children}
      <span
        className="bpp-bar-handle right"
        aria-hidden
        onPointerDown={(e) => drag.startDrag(e, "resize-right")}
      />
    </button>
  );
}
