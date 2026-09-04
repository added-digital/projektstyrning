"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import {
  hourAllocationModeLabel,
  newHourAllocation,
  pricingTypeLabel,
  pricingTypeOrder,
  teamMembers,
  type CustomerData,
  type HourAllocation,
  type HourAllocationMode,
  type PricingType,
  type TeamMember,
} from "@/lib/sections";
import {
  addDays,
  allocationTotalHours,
  countWeekdays,
  todayISO,
} from "@/lib/belaggning";
import { formatPanelDateRange } from "@/lib/timeline";
import { DatePicker } from "@/components/DatePicker";
import { pertEstimate } from "@/lib/capacity";

/**
 * Popup för att planera tid: person → kund → projekt → typ → timmar,
 * datumintervall och kommentar. Sparas som en `HourAllocation` på projektet
 * (i kundens JSON-fil) via sidans vanliga spar-flöde, så ångra fungerar.
 *
 * Listar också personens befintliga planerade tid så att en felaktig post
 * går att ta bort utan att gräva i JSON.
 */

export interface HourAllocationDraft {
  customerSlug: string;
  projectId: string;
  pricingType: PricingType;
  allocation: HourAllocation;
  /** Satt vid redigering: var posten låg innan (kan ha flyttats). */
  replace?: { customerSlug: string; projectId: string; allocationId: string };
}

interface ExistingRow {
  customerSlug: string;
  customer: string;
  projectId: string;
  projectName: string;
  allocation: HourAllocation;
}

/** Projekt som får planeras på — samma statusar som räknas i diagrammet. */
function isPlannable(status: string | undefined): boolean {
  const s = status ?? "active";
  return s === "active" || s === "lead";
}

function formatHoursSv(h: number): string {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}

export function BelaggningAllocPopover({
  person,
  initialDate,
  editAllocationId,
  customers,
  onClose,
  onSave,
  onRemove,
}: {
  person: TeamMember;
  initialDate?: string;
  /** Öppna direkt i redigeringsläge för den här posten. */
  editAllocationId?: string;
  customers: Record<string, CustomerData>;
  onClose: () => void;
  onSave: (draft: HourAllocationDraft) => void;
  onRemove: (customerSlug: string, projectId: string, allocationId: string) => void;
}) {
  const today = useMemo(() => todayISO(), []);
  const [member, setMember] = useState<TeamMember>(person);
  const [customerSlug, setCustomerSlug] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pricingType, setPricingType] = useState<PricingType | "">("");
  const [hoursDraft, setHoursDraft] = useState("");
  const [lowDraft, setLowDraft] = useState("");
  const [likelyDraft, setLikelyDraft] = useState("");
  const [highDraft, setHighDraft] = useState("");
  /** Per vardag är standard; "Totalt" fördelar summan över vardagarna. */
  const [mode, setMode] = useState<HourAllocationMode>("per_day");
  const [startDate, setStartDate] = useState(initialDate ?? today);
  const [endDate, setEndDate] = useState(addDays(initialDate ?? today, 4));
  const [comment, setComment] = useState("");
  /** Posten som redigeras, eller null när formuläret skapar en ny. */
  const [editing, setEditing] = useState<ExistingRow | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const customerOptions = useMemo(
    () =>
      Object.entries(customers)
        .filter(([, c]) => c.projects.some((p) => isPlannable(p.status)))
        .map(([slug, c]) => ({ slug, name: c.client || slug }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [customers],
  );

  const projectOptions = useMemo(() => {
    const c = customers[customerSlug];
    if (!c) return [];
    return c.projects.filter((p) => isPlannable(p.status));
  }, [customers, customerSlug]);

  const selectedProject = projectOptions.find((p) => p.id === projectId);

  // När projektet byts: förvälj projektets typ om den redan är satt.
  useEffect(() => {
    if (!selectedProject) return;
    setPricingType(selectedProject.pricingType ?? "");
  }, [selectedProject]);

  const existing: ExistingRow[] = useMemo(() => {
    const rows: ExistingRow[] = [];
    for (const [slug, c] of Object.entries(customers)) {
      for (const p of c.projects) {
        if (!isPlannable(p.status)) continue;
        for (const a of p.hourAllocations ?? []) {
          if (a.member !== member) continue;
          rows.push({
            customerSlug: slug,
            customer: c.client || slug,
            projectId: p.id,
            projectName: p.name || "(utan namn)",
            allocation: a,
          });
        }
      }
    }
    return rows.sort((a, b) =>
      b.allocation.startDate.localeCompare(a.allocation.startDate),
    );
  }, [customers, member]);

  function startEdit(row: ExistingRow) {
    const a = row.allocation;
    setEditing(row);
    setMember(a.member);
    setCustomerSlug(row.customerSlug);
    setProjectId(row.projectId);
    setHoursDraft(formatHoursSv(a.hours));
    setLowDraft(a.lowHours == null ? "" : formatHoursSv(a.lowHours));
    setLikelyDraft(a.likelyHours == null ? "" : formatHoursSv(a.likelyHours));
    setHighDraft(a.highHours == null ? "" : formatHoursSv(a.highHours));
    setMode(a.mode);
    setStartDate(a.startDate);
    setEndDate(a.endDate);
    setComment(a.comment);
  }

  function stopEdit() {
    setEditing(null);
    setCustomerSlug("");
    setProjectId("");
    setPricingType("");
    setHoursDraft("");
    setLowDraft("");
    setLikelyDraft("");
    setHighDraft("");
    setMode("per_day");
    setStartDate(initialDate ?? today);
    setEndDate(addDays(initialDate ?? today, 4));
    setComment("");
  }

  // Öppnad från en stapel: ladda posten i formuläret direkt.
  const openedEditRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editAllocationId || openedEditRef.current === editAllocationId) return;
    const row = existing.find((r) => r.allocation.id === editAllocationId);
    if (!row) return;
    openedEditRef.current = editAllocationId;
    startEdit(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAllocationId, existing]);

  const hours = Number(hoursDraft.replace(",", "."));
  const low = Number(lowDraft.replace(",", "."));
  const likely = Number(likelyDraft.replace(",", "."));
  const high = Number(highDraft.replace(",", "."));
  const isRange = pricingType === "hogt_lagt";
  const rangeOk = [low, likely, high].every(Number.isFinite) &&
    low >= 0 && low <= likely && likely <= high && high > 0;
  const forecastHours = isRange && rangeOk ? pertEstimate(low, likely, high) : hours;
  const hoursOk = isRange ? rangeOk : Number.isFinite(hours) && hours > 0;
  const datesOk = Boolean(startDate && endDate && endDate >= startDate);
  const weekdays = datesOk ? countWeekdays(startDate, endDate) : 0;
  const perDay =
    hoursOk && datesOk
      ? mode === "per_day"
        ? forecastHours
        : weekdays > 0
          ? forecastHours / weekdays
          : forecastHours
      : 0;
  const total = mode === "per_day" ? forecastHours * weekdays : forecastHours;
  const canSave =
    Boolean(customerSlug && projectId && pricingType) && hoursOk && datesOk;

  function submit() {
    if (!canSave || !pricingType) return;
    const fresh = newHourAllocation(
      member,
      Math.round(forecastHours * 100) / 100,
      startDate,
      endDate,
      comment.trim(),
      mode,
    );
    if (isRange) {
      fresh.estimateMode = "range";
      fresh.lowHours = low;
      fresh.likelyHours = likely;
      fresh.highHours = high;
    } else {
      fresh.estimateMode = "fixed";
    }
    // Vid redigering behålls id och skapad-tid så posten inte byter identitet.
    const allocation: HourAllocation = editing
      ? {
          ...fresh,
          id: editing.allocation.id,
          createdAt: editing.allocation.createdAt,
          ...(editing.allocation.createdBy
            ? { createdBy: editing.allocation.createdBy }
            : {}),
        }
      : fresh;
    onSave({
      customerSlug,
      projectId,
      pricingType,
      allocation,
      ...(editing
        ? {
            replace: {
              customerSlug: editing.customerSlug,
              projectId: editing.projectId,
              allocationId: editing.allocation.id,
            },
          }
        : {}),
    });
  }

  return (
    <>
      <div className="alloc-popover-backdrop" onClick={onClose} />
      <div
        className="alloc-popover belaggning-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Planera tid för ${member}`}
      >
        <div className="alloc-popover-header">
          <div className="alloc-popover-titlewrap">
            <span className="alloc-popover-customer">
              {editing ? "Redigera planerad tid" : "Planera tid"}
            </span>
            <span className="alloc-popover-project">
              {editing
                ? `${editing.customer} · ${editing.projectName}`
                : "Per vardag eller totalt över perioden — helger räknas inte in"}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Stäng"
          >
            <X size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </div>

        <div className="alloc-popover-body">
          <div className="alloc-field">
            <label className="meta-label" htmlFor="bp-member">
              Person
            </label>
            <select
              id="bp-member"
              className="panel-text-input"
              value={member}
              onChange={(e) => setMember(e.target.value as TeamMember)}
            >
              {teamMembers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="alloc-field-row">
            <div className="alloc-field">
              <label className="meta-label" htmlFor="bp-customer">
                Kund
              </label>
              <select
                id="bp-customer"
                className="panel-text-input"
                value={customerSlug}
                autoFocus
                onChange={(e) => {
                  setCustomerSlug(e.target.value);
                  setProjectId("");
                  setPricingType("");
                }}
              >
                <option value="">Välj kund…</option>
                {customerOptions.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="alloc-field">
              <label className="meta-label" htmlFor="bp-project">
                Projekt
              </label>
              <select
                id="bp-project"
                className="panel-text-input"
                value={projectId}
                disabled={!customerSlug}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">
                  {customerSlug ? "Välj projekt…" : "Välj kund först"}
                </option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || "(utan namn)"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="alloc-field">
            <label className="meta-label" htmlFor="bp-type">
              Projekttyp
            </label>
            <select
              id="bp-type"
              className="panel-text-input"
              value={pricingType}
              disabled={!projectId}
              onChange={(e) => setPricingType(e.target.value as PricingType)}
            >
              <option value="">Välj typ…</option>
              {pricingTypeOrder.map((t) => (
                <option key={t} value={t}>
                  {pricingTypeLabel[t]}
                </option>
              ))}
            </select>
            {selectedProject?.pricingType &&
              pricingType &&
              pricingType !== selectedProject.pricingType && (
                <span className="belaggning-hint">
                  Ändrar projektets typ från{" "}
                  {pricingTypeLabel[selectedProject.pricingType]}.
                </span>
              )}
          </div>

          <div className="alloc-field">
            <div className="alloc-hours-head">
              <label className="meta-label" htmlFor="bp-hours">
                {mode === "per_day" ? "Timmar per vardag" : "Timmar totalt"}
              </label>
              <div className="alloc-unit-toggle" role="group" aria-label="Läge">
                {(["per_day", "total"] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={mode === m ? "on" : ""}
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    title={
                      m === "per_day"
                        ? "Samma antal timmar varje vardag i perioden"
                        : "Summan fördelas jämnt över vardagarna i perioden"
                    }
                  >
                    {hourAllocationModeLabel[m]}
                  </button>
                ))}
              </div>
            </div>
            {isRange ? (
              <div className="belaggning-range-inputs">
                <label>Lågt<input inputMode="decimal" value={lowDraft} placeholder="0" onChange={(e) => setLowDraft(e.target.value)} /></label>
                <label>Troligt<input inputMode="decimal" value={likelyDraft} placeholder="0" onChange={(e) => setLikelyDraft(e.target.value)} /></label>
                <label>Högt<input inputMode="decimal" value={highDraft} placeholder="0" onChange={(e) => setHighDraft(e.target.value)} /></label>
              </div>
            ) : (
              <div className="alloc-hours-wrap">
                <input id="bp-hours" type="text" inputMode="decimal" className="panel-text-input" value={hoursDraft} placeholder="0" onChange={(e) => setHoursDraft(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
                <span className="alloc-hours-unit">{mode === "per_day" ? "h/dag" : "h"}</span>
              </div>
            )}
          </div>

          <div className="alloc-field-row">
            <div className="alloc-field">
              <label className="meta-label">Startdatum</label>
              <DatePicker
                value={startDate}
                onChange={(v) => {
                  setStartDate(v);
                  if (endDate && v && endDate < v) setEndDate(v);
                }}
                ariaLabel="Startdatum"
                size="compact"
              />
            </div>
            <div className="alloc-field">
              <label className="meta-label">Slutdatum</label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                ariaLabel="Slutdatum"
                size="compact"
              />
            </div>
          </div>

          <div className="belaggning-preview" aria-live="polite">
            {!datesOk
              ? "Slutdatum måste vara samma som eller efter startdatum."
              : !hoursOk
                ? `${weekdays} vardag${weekdays === 1 ? "" : "ar"} i perioden`
                : isRange
                  ? `Prognos ≈${formatHoursSv(forecastHours)} ${mode === "per_day" ? "h/dag" : "h"} · spann ${formatHoursSv(low)}–${formatHoursSv(high)} h`
                : weekdays === 0
                  ? mode === "per_day"
                    ? "Perioden saknar vardagar — inget planeras."
                    : "Perioden saknar vardagar — timmarna läggs på helgdagarna."
                  : mode === "per_day"
                    ? `${formatHoursSv(perDay)} h varje vardag · ${weekdays} vardag${weekdays === 1 ? "" : "ar"} · ${formatHoursSv(total)} h totalt`
                    : `≈ ${formatHoursSv(perDay)} h per vardag över ${weekdays} vardag${weekdays === 1 ? "" : "ar"} · ${formatHoursSv(total)} h totalt`}
          </div>

          <div className="alloc-field">
            <label className="meta-label" htmlFor="bp-comment">
              Kommentar
            </label>
            <textarea
              id="bp-comment"
              className="panel-text-input belaggning-comment"
              rows={2}
              value={comment}
              placeholder="Valfritt — t.ex. vad tiden ska gå till"
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {existing.length > 0 && (
            <div className="belaggning-existing">
              <span className="meta-label">Planerad tid för {member}</span>
              <ul className="belaggning-existing-list">
                {existing.map((row) => (
                  <li
                    key={row.allocation.id}
                    className={`belaggning-existing-row ${
                      editing?.allocation.id === row.allocation.id
                        ? "is-editing"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="belaggning-existing-text"
                      onClick={() => startEdit(row)}
                      title="Redigera"
                    >
                      <span className="belaggning-existing-title">
                        <Pencil size={11} strokeWidth={2.25} aria-hidden />
                        {row.customer} · {row.projectName}
                      </span>
                      <span className="belaggning-existing-meta">
                        {row.allocation.estimateMode === "range"
                          ? `${formatHoursSv(row.allocation.lowHours ?? 0)}–${formatHoursSv(row.allocation.highHours ?? row.allocation.hours)} h (≈${formatHoursSv(row.allocation.hours)} h)`
                          : row.allocation.mode === "per_day"
                          ? `${formatHoursSv(row.allocation.hours)} h/dag (${formatHoursSv(allocationTotalHours(row.allocation))} h)`
                          : `${formatHoursSv(row.allocation.hours)} h totalt`}{" "}
                        ·{" "}
                        {formatPanelDateRange(
                          row.allocation.startDate,
                          row.allocation.endDate,
                        )}
                        {row.allocation.comment
                          ? ` · ${row.allocation.comment}`
                          : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label="Ta bort planerad tid"
                      title="Ta bort"
                      onClick={() => {
                        if (editing?.allocation.id === row.allocation.id) stopEdit();
                        onRemove(row.customerSlug, row.projectId, row.allocation.id);
                      }}
                    >
                      <Trash2 size={13} strokeWidth={2.25} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="alloc-popover-footer">
          {editing && (
            <button
              type="button"
              className="btn btn-mute small"
              onClick={stopEdit}
              title="Lämna redigeringen och skapa en ny post i stället"
            >
              Ny post
            </button>
          )}
          <div className="alloc-popover-footer-right" style={{ marginLeft: "auto" }}>
            <button type="button" className="btn btn-mute small" onClick={onClose}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn small"
              onClick={submit}
              disabled={!canSave}
            >
              {editing ? "Spara ändringar" : "Spara"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
