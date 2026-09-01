"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Plus, RefreshCw } from "lucide-react";
import {
  newTask,
  teamMembers,
  type CustomerData,
  type ProjectTask,
  type TeamMember,
} from "@/lib/sections";
import {
  fetchAllCustomers,
  fetchDataVersion,
  saveCustomer,
} from "@/lib/customersClient";
import {
  collectTasks,
  dueLabel,
  groupTasksByMember,
  type TaskGroup,
  type TaskInContext,
} from "@/lib/tasks";
import { DatePicker } from "@/components/DatePicker";
import { showToast } from "@/components/Toast";

/**
 * Notissidan: alla kortsiktiga uppgifter, grupperade per person.
 *
 * Uppgifterna skrivs oftast av Codex direkt i `data/<kund>.json` (under
 * projektets `tasks`). Sidan pollar filversionen varannan sekund, så det som
 * sägs på mötet dyker upp här utan omladdning. Härifrån bockar man av dem —
 * och lägger till en egen notis via "Ny notis" när något dyker upp mellan
 * mötena.
 */

/** Ett valbart projekt i "Ny notis"-formuläret. */
interface ProjectOption {
  customerSlug: string;
  customer: string;
  projectId: string;
  projectName: string;
}

/** Fälten som krävs för att skapa en notis. */
interface NewTaskInput {
  customerSlug: string;
  projectId: string;
  text: string;
  assignee: TeamMember | "";
  dueDate: string;
}

export default function NotiserPage() {
  const [customers, setCustomers] = useState<Record<string, CustomerData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const dataVersionRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const load = useCallback(async (mode: "initial" | "silent" = "silent") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    try {
      const all = await fetchAllCustomers();
      setCustomers(all);
      setError(null);
      const version = await fetchDataVersion();
      if (version) dataVersionRef.current = version.version;
    } catch (err) {
      if (mode === "initial") setError(String(err));
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load("initial");
  }, [load]);

  // Auto-uppdatering när JSON-filerna ändras på disk (Codex-edits).
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function poll() {
      if (cancelled || inFlight || savingRef.current) return;
      inFlight = true;
      try {
        const next = await fetchDataVersion();
        if (!next) return;
        const prev = dataVersionRef.current;
        if (!prev) {
          dataVersionRef.current = next.version;
          return;
        }
        if (next.version !== prev) {
          dataVersionRef.current = next.version;
          await load("silent");
        }
      } finally {
        inFlight = false;
      }
    }
    const interval = window.setInterval(poll, 2000);
    function onFocus() {
      if (!savingRef.current) load("silent");
    }
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /** Uppdaterar en uppgift optimistiskt och sparar kunden. */
  const patchTask = useCallback(
    async (
      ctx: TaskInContext,
      patch: Partial<ProjectTask>,
    ) => {
      const current = customers[ctx.customerSlug];
      if (!current) return;
      const next: CustomerData = {
        ...current,
        projects: current.projects.map((p) =>
          p.id === ctx.projectId
            ? {
                ...p,
                tasks: (p.tasks ?? []).map((t) =>
                  t.id === ctx.task.id ? { ...t, ...patch } : t,
                ),
              }
            : p,
        ),
      };
      setCustomers((prev) => ({ ...prev, [ctx.customerSlug]: next }));
      savingRef.current = true;
      try {
        const saved = await saveCustomer(ctx.customerSlug, next);
        if (!saved) {
          showToast("Kunde inte spara — laddar om");
          await load("silent");
          return;
        }
        const version = await fetchDataVersion();
        if (version) dataVersionRef.current = version.version;
      } finally {
        savingRef.current = false;
      }
    },
    [customers, load],
  );

  /**
   * Lägger till en ny uppgift på valt projekt. Samma optimistiska mönster som
   * patchTask. Returnerar false om sparningen misslyckades, så att formuläret
   * kan stå kvar med texten istället för att tappa det man just skrev.
   */
  const createTask = useCallback(
    async (input: NewTaskInput): Promise<boolean> => {
      const current = customers[input.customerSlug];
      if (!current) return false;
      const task = newTask(input.text.trim(), input.assignee, input.dueDate);
      const next: CustomerData = {
        ...current,
        projects: current.projects.map((p) =>
          p.id === input.projectId
            ? { ...p, tasks: [...(p.tasks ?? []), task] }
            : p,
        ),
      };
      setCustomers((prev) => ({ ...prev, [input.customerSlug]: next }));
      savingRef.current = true;
      try {
        const saved = await saveCustomer(input.customerSlug, next);
        if (!saved) {
          showToast("Kunde inte spara notisen — laddar om");
          await load("silent");
          return false;
        }
        const version = await fetchDataVersion();
        if (version) dataVersionRef.current = version.version;
        showToast("Notis skapad");
        return true;
      } finally {
        savingRef.current = false;
      }
    },
    [customers, load],
  );

  /**
   * Projekt man kan lägga en notis på. Arkiverade utelämnas — de filtreras
   * ändå bort av collectTasks, så en notis där hade blivit osynlig.
   */
  const projectOptions = useMemo<ProjectOption[]>(() => {
    const out: ProjectOption[] = [];
    for (const slug of Object.keys(customers)) {
      const c = customers[slug];
      for (const p of c.projects) {
        if ((p.status ?? "active") === "archived") continue;
        out.push({
          customerSlug: slug,
          customer: c.client || slug,
          projectId: p.id,
          projectName: p.name || "(utan namn)",
        });
      }
    }
    return out.sort(
      (a, b) =>
        a.customer.localeCompare(b.customer, "sv") ||
        a.projectName.localeCompare(b.projectName, "sv"),
    );
  }, [customers]);

  const { tasks, hiddenArchived } = useMemo(
    () => collectTasks(customers),
    [customers],
  );
  const groups: TaskGroup[] = useMemo(
    () => groupTasksByMember(tasks),
    [tasks],
  );

  const openCount = groups.reduce((n, g) => n + g.open.length, 0);
  const doneCount = groups.reduce((n, g) => n + g.done.length, 0);

  return (
    <>
      <div className="page-toolbar notice-toolbar">
        <div className="page-toolbar-inner">
          <Link href="/" className="btn btn-mute toolbar-btn">
            <ArrowLeft size={14} strokeWidth={2.25} aria-hidden /> Tidslinjen
          </Link>

          <h1 className="notice-title">Notiser</h1>
          <span className="notice-count">
            {openCount} {openCount === 1 ? "öppen uppgift" : "öppna uppgifter"}
          </span>

          <button
            type="button"
            className="icon-btn toolbar-refresh"
            onClick={() => load("silent")}
            title="Ladda om från servern"
            aria-label="Ladda om"
          >
            <RefreshCw
              size={13}
              strokeWidth={2.25}
              aria-hidden
              className={refreshing ? "spin" : ""}
            />
          </button>

          <div className="toolbar-spacer" />

          {doneCount > 0 && (
            <button
              type="button"
              className={`filter-pill ${showDone ? "on" : ""}`}
              onClick={() => setShowDone((v) => !v)}
              aria-pressed={showDone}
            >
              Visa avbockade ({doneCount})
            </button>
          )}

          <button
            type="button"
            className="btn toolbar-btn"
            onClick={() => setComposing(true)}
            disabled={loading || !!error}
          >
            <Plus size={14} strokeWidth={2.25} aria-hidden /> Ny notis
          </button>
        </div>
      </div>

      <div className="main notice-main">
        {loading ? (
          <div className="empty-state large">Hämtar uppgifter…</div>
        ) : error ? (
          <div className="empty-state large">Kunde inte hämta data: {error}</div>
        ) : (
          <div className="notice-grid">
            {groups.map((group) => (
              <section className="notice-card" key={group.key || "unassigned"}>
                <header className="notice-card-head">
                  <span className="notice-person">{group.label}</span>
                  <span className="notice-badge">{group.open.length}</span>
                </header>

                {group.open.length === 0 && (!showDone || group.done.length === 0) ? (
                  <p className="notice-empty">Inget just nu.</p>
                ) : (
                  <ul className="notice-list">
                    {group.open.map((ctx) => (
                      <TaskRow
                        key={ctx.task.id}
                        ctx={ctx}
                        todayISO={todayISO}
                        onToggle={() => patchTask(ctx, { done: true })}
                      />
                    ))}
                    {showDone &&
                      group.done.map((ctx) => (
                        <TaskRow
                          key={ctx.task.id}
                          ctx={ctx}
                          todayISO={todayISO}
                          onToggle={() => patchTask(ctx, { done: false })}
                        />
                      ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        {hiddenArchived > 0 && (
          <p className="notice-footnote">
            {hiddenArchived}{" "}
            {hiddenArchived === 1 ? "uppgift ligger" : "uppgifter ligger"} på
            arkiverade projekt och visas inte här.
          </p>
        )}
      </div>

      {composing && (
        <NewTaskForm
          options={projectOptions}
          onClose={() => setComposing(false)}
          onCreate={createTask}
        />
      )}
    </>
  );
}

function TaskRow({
  ctx,
  todayISO,
  onToggle,
}: {
  ctx: TaskInContext;
  todayISO: string;
  onToggle: () => void;
}) {
  const due = dueLabel(ctx.task.dueDate, todayISO);
  return (
    <li className={`notice-item ${ctx.task.done ? "is-done" : ""}`}>
      <button
        type="button"
        className={`notice-check ${ctx.task.done ? "on" : ""}`}
        onClick={onToggle}
        aria-pressed={ctx.task.done}
        aria-label={ctx.task.done ? "Markera som ej klar" : "Markera som klar"}
      >
        {ctx.task.done && <Check size={11} strokeWidth={3} aria-hidden />}
      </button>
      <div className="notice-item-body">
        <span className="notice-text">{ctx.task.text}</span>
        <span className="notice-meta">
          <span className="notice-project">
            {ctx.customer} · {ctx.projectName}
          </span>
          {due && (
            <span className={`notice-due tone-${due.tone}`}>{due.text}</span>
          )}
        </span>
      </div>
    </li>
  );
}

/**
 * Pop-up för att skriva en notis för hand.
 *
 * En uppgift måste bo på ett projekt (det är där `tasks` ligger i JSON:en),
 * så projektvalet är obligatoriskt. Finns bara ett projekt väljs det åt en —
 * annars får man peka ut det, hellre det än att notisen tyst hamnar fel.
 */
function NewTaskForm({
  options,
  onClose,
  onCreate,
}: {
  options: ProjectOption[];
  onClose: () => void;
  onCreate: (input: NewTaskInput) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState<TeamMember | "">("");
  const [target, setTarget] = useState(options.length === 1 ? "0" : "");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Kunder i tur och ordning, för optgroup-rubrikerna.
  const grouped = useMemo(() => {
    const map = new Map<string, { option: ProjectOption; index: number }[]>();
    options.forEach((option, index) => {
      const list = map.get(option.customer) ?? [];
      list.push({ option, index });
      map.set(option.customer, list);
    });
    return Array.from(map.entries());
  }, [options]);

  const chosen = target === "" ? null : options[Number(target)] ?? null;
  const canSubmit = !!text.trim() && !!chosen && !submitting;

  async function submit() {
    if (!canSubmit || !chosen) return;
    setSubmitting(true);
    const ok = await onCreate({
      customerSlug: chosen.customerSlug,
      projectId: chosen.projectId,
      text,
      assignee,
      dueDate,
    });
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-form notice-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Ny notis"
      >
        <div className="modal-form-title">Ny notis</div>

        {options.length === 0 ? (
          <>
            <p className="notice-modal-empty">
              Det finns inga aktiva projekt att lägga en notis på. Skapa ett
              projekt på tidslinjen först.
            </p>
            <div className="modal-form-actions">
              <button type="button" className="btn btn-mute" onClick={onClose}>
                Stäng
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="notice-modal-field">
              <label className="meta-label" htmlFor="notice-text">
                Uppgift
              </label>
              <input
                ref={inputRef}
                id="notice-text"
                type="text"
                className="panel-text-input"
                placeholder="Vad ska göras?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </div>

            <div className="notice-modal-field">
              <label className="meta-label" htmlFor="notice-project">
                Projekt
              </label>
              <select
                id="notice-project"
                className="panel-text-input"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Välj projekt…</option>
                {grouped.map(([customer, entries]) => (
                  <optgroup key={customer} label={customer}>
                    {entries.map(({ option, index }) => (
                      <option key={option.projectId} value={String(index)}>
                        {option.projectName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="notice-modal-row">
              <div className="notice-modal-field">
                <label className="meta-label" htmlFor="notice-assignee">
                  Person
                </label>
                <select
                  id="notice-assignee"
                  className="panel-text-input"
                  value={assignee}
                  onChange={(e) =>
                    setAssignee(e.target.value as TeamMember | "")
                  }
                >
                  <option value="">Ej tilldelat</option>
                  {teamMembers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="notice-modal-field">
                <span className="meta-label">Deadline</span>
                <DatePicker
                  value={dueDate}
                  onChange={setDueDate}
                  placeholder="Inget datum"
                  ariaLabel="Deadline"
                />
              </div>
            </div>

            <div className="modal-form-actions">
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={!canSubmit}
              >
                {submitting ? "Skapar…" : "Skapa notis"}
              </button>
              <button type="button" className="btn btn-mute" onClick={onClose}>
                Avbryt
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
