"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isoWeekString,
  isPhaseCategoryAssignee,
  newAllocation,
  newComment,
  newPhase,
  newProject,
  newWeeklyNote,
  phaseOrder,
  projectStatusLabel,
  projectStatusOrder,
  teamMembers,
  WEEKLY_CAPACITY,
  type CommentAssignee,
  type CustomerData,
  type PhaseComment,
  type PhaseType,
  type Project,
  type ProjectAllocation,
  type ProjectPhase,
  type ProjectStatus,
  type TeamMember,
  type WeeklyNote,
} from "@/lib/sections";
import {
  computeWeeklyBookings,
  formatHours,
  formatHoursCompact,
  hoursInputValue,
  loadLevel,
  parseHoursInput,
  HOURS_PRESETS,
  type HoursUnit,
  type WeekBooking,
} from "@/lib/workload";
import {
  HEADER_ROW_HEIGHT,
  LABEL_WIDTH,
  PHASE_ROW_HEIGHT,
  WEEK_WIDTH,
  addDaysToISO,
  currentWeekIndex,
  dateRangeToWeeks,
  fmtDay,
  formatPanelDateRange,
  isoRangeToWeeks,
  isoWeeksOfYear,
  monthGroups,
  parseISODate,
  pastWeekFadeClass,
  weekSpan,
  type RangeResult,
  type WeekInfo,
} from "@/lib/timeline";
import {
  shiftRange,
  useTimelineDrag,
  type DragMode,
} from "@/lib/useTimelineDrag";
import Link from "next/link";
import {
  fetchAllCustomers,
  fetchDataVersion,
  subscribeToCustomerChanges,
  saveCustomer,
} from "@/lib/customersClient";
import { ProjectPanel } from "@/components/ProjectPanel";
import { DatePicker } from "@/components/DatePicker";
import { showToast } from "@/components/Toast";
import {
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Pencil,
  Plus,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";

// ---- Types -----------------------------------------------------------------

interface ProjectRow {
  customer: string;
  customerSlug: string;
  project: Project;
}

interface SelectedPhase {
  customerSlug: string;
  projectId: string;
  phaseId: string;
}

/** Markerad stapel i tidslinjen — fas eller allokering. */
interface SelectedBar {
  kind: "phase" | "alloc";
  customerSlug: string;
  projectId: string;
  id: string;
}

/** En ångrbar ändring: hela kunddatan som den såg ut innan. */
interface UndoEntry {
  snapshot: Record<string, CustomerData>;
  label: string;
  /** Ändringar med samma nyckel tätt inpå varandra slås ihop till ett steg. */
  mergeKey: string | null;
  at: number;
}

/** Tooltip på staplarna — enda stället där kortkommandona syns. */
const BAR_HINT =
  "Dra för att flytta · kanterna ändrar längd · ⌥ ger dagar istället för veckor\n←/→ flyttar markerad stapel · ⇧←/→ ändrar längd · ⌘Z ångrar";

const HOURS_UNIT_KEY = "planering:hoursUnit";
/** Hur länge två likadana ändringar slås ihop till ett ångra-steg (ms). */
const UNDO_MERGE_MS = 1200;
const UNDO_LIMIT = 60;

function autoGrowComment(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.max(28, el.scrollHeight)}px`;
}

/** Does this comment match the given assignee filter (category or person)? */
function commentMatchesFilter(
  c: PhaseComment,
  filter: CommentAssignee,
): boolean {
  if (!filter) return true;
  if (isPhaseCategoryAssignee(filter)) return c.category === filter;
  return c.assignees.includes(filter as TeamMember);
}

/** Renders the category pill (optional) + one pill per assignee. */
function CommentBadges({
  category,
  assignees,
  baseClass,
}: {
  category?: PhaseType | "";
  assignees: TeamMember[];
  baseClass: string;
}) {
  if (!category && assignees.length === 0) return null;
  return (
    <span className="comment-badges">
      {category && (
        <span className={`${baseClass} is-category`}>
          <span
            className={`legend-dot phase-swatch-${category.toLowerCase()}`}
            aria-hidden
          />
          {category}
        </span>
      )}
      {assignees.map((a) => (
        <span key={a} className={baseClass}>
          {a}
        </span>
      ))}
    </span>
  );
}

// ---- Page ------------------------------------------------------------------

export default function PlaneringPage() {
  const today = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }, []);

  const [year, setYear] = useState<number>(today.getUTCFullYear());
  const [customers, setCustomers] = useState<Record<string, CustomerData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekPopover, setWeekPopover] = useState<{
    week: WeekInfo;
    weekIdx: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<SelectedPhase | null>(
    null,
  );
  const [selectedProject, setSelectedProject] = useState<{
    customerSlug: string;
    projectId: string;
  } | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<CommentAssignee>("");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Set<ProjectStatus>>(
    () => new Set(["active", "lead"]),
  );
  const [newProjectFor, setNewProjectFor] = useState<string | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  /** Markerad stapel — tar emot piltangenter. */
  const [selectedBar, setSelectedBar] = useState<SelectedBar | null>(null);
  const [hoursUnit, setHoursUnit] = useState<HoursUnit>("h");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HOURS_UNIT_KEY);
      if (stored === "h" || stored === "%") setHoursUnit(stored);
    } catch {
      // localStorage kan vara blockerat — h är en bra default.
    }
  }, []);

  const changeHoursUnit = useCallback((unit: HoursUnit) => {
    setHoursUnit(unit);
    try {
      window.localStorage.setItem(HOURS_UNIT_KEY, unit);
    } catch {
      // Ignorera — enheten gäller ändå för den här sessionen.
    }
  }, []);

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  /** Spegling av `customers` som går att läsa synkront i event-handlers. */
  const customersRef = useRef<Record<string, CustomerData>>({});
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const bootstrappedRef = useRef(false);
  const dataVersionRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Bootstrap / refresh: ladda all kund-data från servern.
  //
  // Bryts ut till en återanvändbar funktion så att vi kan trigga om-laddning
  // när:
  //  - sidan monteras (bootstrap)
  //  - användaren klickar refresh-knappen i toolbaren
  //  - browser-fönstret återfår fokus (t.ex. efter en JSON-edit i Codex)
  //
  // mode: "initial" visar "Hämtar projekt…"-spinnern, "silent" gör om-
  // laddningen i bakgrunden utan att rita om hela ytan.
  const loadCustomers = useCallback(
    async (mode: "initial" | "silent" = "silent") => {
      if (mode === "initial") {
        setLoading(true);
        setError(null);
      }
      try {
        const all = await fetchAllCustomers();
        setCustomers(all);
        bootstrappedRef.current = true;
        // Refresh lyckas även om den lättviktiga versionskollen missar.
        const version = await fetchDataVersion();
        if (version) dataVersionRef.current = version.version;
        if (mode === "silent") {
          // Visa en kort "uppdaterad"-flash så användaren ser att data
          // synkades från servern utan att vi behöver en separat indikator.
          setSaveStatus("saved");
          if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
          savedFlashRef.current = setTimeout(() => setSaveStatus("idle"), 1200);
        }
      } catch (err) {
        if (mode === "initial") setError(String(err));
      } finally {
        if (mode === "initial") setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  useEffect(() => {
    loadCustomers("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh via Supabase Realtime: varje write i customers-tabellen
  // (annan flik, kollega, Codex via API:t) triggar en tyst omladdning.
  // Samma spärrar som pollingen hade: hoppa över medan en egen save är
  // pågående eller debouncad, så lokala ändringar inte skrivs över.
  useEffect(() => {
    const unsubscribe = subscribeToCustomerChanges(() => {
      if (!bootstrappedRef.current) return;
      if (saveTimers.current.size > 0) return;
      if (saveStatus === "saving") return;
      void loadCustomers("silent");
    });
    return unsubscribe;
  }, [loadCustomers, saveStatus]);

  // Auto-refresh när fönstret återfår fokus. Skippas om vi har en pågående
  // spar (saveTimers har poster) så att vi inte överskriver osparade
  // lokala ändringar med stale server-data.
  useEffect(() => {
    function onFocus() {
      if (!bootstrappedRef.current) return;
      if (saveTimers.current.size > 0) return;
      if (saveStatus === "saving") return;
      loadCustomers("silent");
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onFocus();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [loadCustomers, saveStatus]);

  // ---- Persistence ----
  const scheduleSave = useCallback((slug: string, data: CustomerData) => {
    const existing = saveTimers.current.get(slug);
    if (existing) clearTimeout(existing);
    setSaveStatus("saving");
    saveTimers.current.set(
      slug,
      setTimeout(async () => {
        try {
          const json = await saveCustomer(slug, data);
          if (!json) {
            setSaveStatus("error");
            return;
          }
          // Handle slug rename (when client name changes)
          if (json.slug !== slug) {
            setCustomers((prev) => {
              if (!prev[slug]) return prev;
              const next = { ...prev };
              delete next[slug];
              next[json.slug] = json.data;
              return next;
            });
            saveTimers.current.delete(slug);
            setSelectedProject((prev) =>
              prev && prev.customerSlug === slug
                ? { ...prev, customerSlug: json.slug }
                : prev,
            );
            setSelectedPhase((prev) =>
              prev && prev.customerSlug === slug
                ? { ...prev, customerSlug: json.slug }
                : prev,
            );
            setNewProjectFor((prev) => (prev === slug ? json.slug : prev));
          }
          setSaveStatus("saved");
          if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
          savedFlashRef.current = setTimeout(
            () => setSaveStatus("idle"),
            1500,
          );
        } catch (err) {
          console.error("Save failed", err);
          setSaveStatus("error");
        }
      }, 500),
    );
  }, []);

  // ---- Ångra / gör om ----
  //
  // Varje mutation lägger undan en ögonblicksbild av kunddatan innan den
  // ändras. Snapshotarna delar struktur med varandra (allt är immutabelt
  // uppdaterat), så 60 steg kostar nästan ingenting i minne.
  const pushUndo = useCallback((label: string, mergeKey?: string) => {
    const stack = undoStack.current;
    const last = stack[stack.length - 1];
    if (
      mergeKey &&
      last &&
      last.mergeKey === mergeKey &&
      Date.now() - last.at < UNDO_MERGE_MS
    ) {
      // Samma sak igen direkt efter — behåll det äldre läget, uppdatera bara
      // tidsstämpeln så att en lång redigering blir ETT ångra-steg.
      last.at = Date.now();
      redoStack.current = [];
      return;
    }
    stack.push({
      snapshot: customersRef.current,
      label,
      mergeKey: mergeKey ?? null,
      at: Date.now(),
    });
    if (stack.length > UNDO_LIMIT) stack.shift();
    redoStack.current = [];
    setUndoDepth(stack.length);
  }, []);

  /** Återställer en ögonblicksbild och sparar de kunder som faktiskt ändrats. */
  const restoreSnapshot = useCallback(
    (snapshot: Record<string, CustomerData>) => {
      const current = customersRef.current;
      customersRef.current = snapshot;
      setCustomers(snapshot);
      const slugs = new Set([
        ...Object.keys(current),
        ...Object.keys(snapshot),
      ]);
      for (const slug of slugs) {
        const next = snapshot[slug];
        if (next && current[slug] !== next) scheduleSave(slug, next);
      }
    },
    [scheduleSave],
  );

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) {
      showToast("Inget att ångra");
      return;
    }
    redoStack.current.push({
      snapshot: customersRef.current,
      label: entry.label,
      mergeKey: null,
      at: Date.now(),
    });
    restoreSnapshot(entry.snapshot);
    setUndoDepth(undoStack.current.length);
    showToast(`Ångrade: ${entry.label}`);
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push({
      snapshot: customersRef.current,
      label: entry.label,
      mergeKey: null,
      at: Date.now(),
    });
    restoreSnapshot(entry.snapshot);
    setUndoDepth(undoStack.current.length);
    showToast(`Gjorde om: ${entry.label}`);
  }, [restoreSnapshot]);

  // ---- Mutators ----
  const patchPhase = useCallback(
    (
      slug: string,
      projectId: string,
      phaseId: string,
      patch: Partial<ProjectPhase>,
    ) => {
      pushUndo("fasändring", `phase:${phaseId}:${Object.keys(patch).join(",")}`);
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  phases: (p.phases ?? []).map((ph) =>
                    ph.id === phaseId ? { ...ph, ...patch } : ph,
                  ),
                }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave, pushUndo],
  );

  const patchProject = useCallback(
    (slug: string, projectId: string, patch: Partial<Project>) => {
      pushUndo(
        "projektändring",
        `project:${projectId}:${Object.keys(patch).join(",")}`,
      );
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId ? { ...p, ...patch } : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave, pushUndo],
  );

  /** Hjälpare som mutar allocations-arrayen på ett projekt och sparar. */
  const mutateAllocations = useCallback(
    (
      slug: string,
      projectId: string,
      mutator: (allocs: ProjectAllocation[]) => ProjectAllocation[],
      label = "bemanningsändring",
      mergeKey?: string,
    ) => {
      pushUndo(label, mergeKey);
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) => {
            if (p.id !== projectId) return p;
            const nextAllocs = mutator(p.allocations ?? []);
            return { ...p, allocations: nextAllocs };
          }),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave, pushUndo],
  );

  const addAllocation = useCallback(
    (slug: string, projectId: string, allocation: ProjectAllocation) => {
      mutateAllocations(
        slug,
        projectId,
        (allocs) => [...allocs, allocation],
        "tillagd person",
      );
    },
    [mutateAllocations],
  );

  const patchAllocation = useCallback(
    (
      slug: string,
      projectId: string,
      allocationId: string,
      patch: Partial<ProjectAllocation>,
    ) => {
      const isTime = "hoursPerWeek" in patch;
      mutateAllocations(
        slug,
        projectId,
        (allocs) =>
          allocs.map((a) => (a.id === allocationId ? { ...a, ...patch } : a)),
        isTime ? "ändrad tid" : "flyttad allokering",
        `alloc:${allocationId}:${Object.keys(patch).join(",")}`,
      );
    },
    [mutateAllocations],
  );

  const removeAllocation = useCallback(
    (slug: string, projectId: string, allocationId: string) => {
      mutateAllocations(
        slug,
        projectId,
        (allocs) => allocs.filter((a) => a.id !== allocationId),
        "borttagen allokering",
      );
    },
    [mutateAllocations],
  );

  /**
   * Kopierar en allokering och lägger kopian direkt efter originalet.
   * Kopian byggs innan state-uppdateringen så att anroparen kan öppna
   * popovern för den nya raden direkt (setCustomers-uppdateraren körs först
   * vid nästa render och kan inte returnera något).
   */
  const duplicateAllocation = useCallback(
    (slug: string, projectId: string, allocationId: string): string | null => {
      const project = customersRef.current[slug]?.projects.find(
        (p) => p.id === projectId,
      );
      const source = (project?.allocations ?? []).find(
        (a) => a.id === allocationId,
      );
      if (!source) return null;
      const startDate = source.endDate ? addDaysToISO(source.endDate, 1) : "";
      const spanDays =
        source.startDate && source.endDate
          ? Math.round(
              (new Date(source.endDate + "T00:00:00Z").getTime() -
                new Date(source.startDate + "T00:00:00Z").getTime()) /
                86400000,
            )
          : 6;
      const copy = newAllocation(
        source.member,
        startDate,
        startDate ? addDaysToISO(startDate, spanDays) : "",
        source.hoursPerWeek,
      );
      mutateAllocations(
        slug,
        projectId,
        (allocs) => [...allocs, copy],
        "duplicerad allokering",
      );
      return copy.id;
    },
    [mutateAllocations],
  );

  /**
   * Save or clear a weekly note for a (project, ISO week) pair. Empty text
   * removes the note. Used by the bar hover tooltip for quick notes taken
   * during planning meetings.
   */
  const saveWeeklyNote = useCallback(
    (slug: string, projectId: string, yearWeek: string, text: string) => {
      pushUndo("veckonotering", `note:${projectId}:${yearWeek}`);
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) => {
            if (p.id !== projectId) return p;
            const existing = p.weeklyNotes ?? [];
            let nextNotes: WeeklyNote[];
            const trimmed = text.trim();
            if (trimmed === "") {
              nextNotes = existing.filter((n) => n.yearWeek !== yearWeek);
            } else {
              const has = existing.some((n) => n.yearWeek === yearWeek);
              if (has) {
                nextNotes = existing.map((n) =>
                  n.yearWeek === yearWeek
                    ? { ...n, text: trimmed, updatedAt: new Date().toISOString() }
                    : n,
                );
              } else {
                nextNotes = [...existing, newWeeklyNote(yearWeek, trimmed)];
              }
            }
            return { ...p, weeklyNotes: nextNotes };
          }),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave, pushUndo],
  );

  const patchCustomer = useCallback(
    (slug: string, patch: Partial<CustomerData>) => {
      pushUndo("kundändring", `customer:${slug}:${Object.keys(patch).join(",")}`);
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = { ...c, ...patch };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave, pushUndo],
  );

  const deleteProject = useCallback(
    (slug: string, projectId: string) => {
      let removedName = "";
      pushUndo("borttaget projekt");
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        removedName = c.projects.find((p) => p.id === projectId)?.name ?? "";
        const next: CustomerData = {
          ...c,
          projects: c.projects.filter((p) => p.id !== projectId),
          activeProjectId:
            c.activeProjectId === projectId
              ? c.projects.find((p) => p.id !== projectId)?.id ?? null
              : c.activeProjectId,
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
      showToast(
        removedName ? `"${removedName}" borttaget` : "Projekt borttaget",
      );
    },
    [scheduleSave, pushUndo],
  );

  const addProjectToCustomer = useCallback(
    (slug: string, projectName: string) => {
      const trimmed = projectName.trim() || "Nytt projekt";
      const p = newProject(trimmed);
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: [...c.projects, p],
          activeProjectId: p.id,
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
      // Open the project panel so the user can immediately edit
      setSelectedProject({ customerSlug: slug, projectId: p.id });
      showToast(`Projektet "${trimmed}" skapat`);
    },
    [scheduleSave],
  );

  const addSprint = useCallback(
    (slug: string, projectId: string, type: PhaseType) => {
      pushUndo("ny sprint");
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const project = c.projects.find((p) => p.id === projectId);
        if (!project) return prev;

        // Default dates: chain after the latest sprint of this type.
        let startDate = "";
        let endDate = "";
        const sameType = (project.phases ?? []).filter((p) => p.type === type);
        const latestEnd = sameType
          .map((p) => p.endDate)
          .filter((d) => !!d)
          .sort()
          .pop();
        if (latestEnd) {
          startDate = addDaysToISO(latestEnd, 1);
          endDate = addDaysToISO(startDate, 6);
        } else if (project.startDate) {
          startDate = project.startDate;
          endDate = addDaysToISO(startDate, 6);
        }

        const np = newPhase(type);
        np.startDate = startDate;
        np.endDate = endDate;

        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: [...(p.phases ?? []), np] }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  /** Lägg till en fas med givna datum + typ — används av QuickCreatePopover. */
  const addPhase = useCallback(
    (slug: string, projectId: string, phase: ProjectPhase) => {
      pushUndo("ny fas");
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: [...(p.phases ?? []), phase] }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  /** Ta bort en fas från ett projekt — används av högerklick-meny. */
  const removePhase = useCallback(
    (slug: string, projectId: string, phaseId: string) => {
      pushUndo("borttagen fas");
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: (p.phases ?? []).filter((ph) => ph.id !== phaseId) }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  /** Kopierar en fas och kedjar kopian direkt efter originalet. */
  const duplicatePhase = useCallback(
    (slug: string, projectId: string, phaseId: string) => {
      const project = customersRef.current[slug]?.projects.find(
        (p) => p.id === projectId,
      );
      const source = (project?.phases ?? []).find((ph) => ph.id === phaseId);
      if (!source) return;
      const copy = newPhase(source.type);
      copy.label = source.label;
      copy.notes = source.notes;
      if (source.startDate && source.endDate) {
        const spanDays = Math.round(
          (new Date(source.endDate + "T00:00:00Z").getTime() -
            new Date(source.startDate + "T00:00:00Z").getTime()) /
            86400000,
        );
        copy.startDate = addDaysToISO(source.endDate, 1);
        copy.endDate = addDaysToISO(copy.startDate, spanDays);
      }
      pushUndo("duplicerad fas");
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: [...(p.phases ?? []), copy] }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave, pushUndo],
  );

  const addCustomer = useCallback(async (clientName: string) => {
    const trimmed = clientName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: trimmed }),
      });
      if (!res.ok) {
        showToast("Kunde inte skapa kund");
        return;
      }
      const json: { slug: string; data: CustomerData } = await res.json();
      setCustomers((prev) => ({ ...prev, [json.slug]: json.data }));
      showToast(`${trimmed} tillagd — välj projektnamn`);
      // Chain: open the new-project form so the customer becomes visible
      // in the timeline (otherwise they have no projects and stay hidden).
      setNewProjectFor(json.slug);
    } catch (err) {
      console.error(err);
      showToast("Kunde inte skapa kund");
    }
  }, []);

  /**
   * Flyttar (eller förlänger) den markerade stapeln med tangentbordet.
   * `edge: "end"` ändrar bara slutdatumet.
   */
  const nudgeSelected = useCallback(
    (days: number, edge: "both" | "end") => {
      const sel = selectedBar;
      if (!sel) return;
      const c = customersRef.current[sel.customerSlug];
      const project = c?.projects.find((p) => p.id === sel.projectId);
      if (!project) return;
      const snap = Math.abs(days) >= 7;
      if (sel.kind === "phase") {
        const ph = (project.phases ?? []).find((x) => x.id === sel.id);
        if (!ph?.startDate || !ph.endDate) return;
        const next = shiftRange(
          ph.startDate,
          ph.endDate,
          edge === "end" ? "resize-right" : "move",
          days,
          snap,
        );
        patchPhase(sel.customerSlug, sel.projectId, sel.id, next);
      } else {
        const a = (project.allocations ?? []).find((x) => x.id === sel.id);
        if (!a?.startDate || !a.endDate) return;
        const next = shiftRange(
          a.startDate,
          a.endDate,
          edge === "end" ? "resize-right" : "move",
          days,
          snap,
        );
        patchAllocation(sel.customerSlug, sel.projectId, sel.id, next);
      }
    },
    [selectedBar, patchPhase, patchAllocation],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape" && selectedBar) {
        setSelectedBar(null);
        return;
      }
      if (!selectedBar) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (mod) return;
      e.preventDefault();
      // ⌥ = dagsprecision, ⇧ = ändra längd istället för att flytta.
      const step = e.altKey ? 1 : 7;
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      nudgeSelected(step * dir, e.shiftKey ? "end" : "both");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBar, nudgeSelected, undo, redo]);

  // Klick utanför staplarna avmarkerar.
  useEffect(() => {
    if (!selectedBar) return;
    function onPointerDown(e: PointerEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest(".phase-bar-wrapper, .team-alloc-bar, .alloc-popover, .phase-popover, .phase-context-menu")) {
        return;
      }
      setSelectedBar(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [selectedBar]);

  // ---- Derived ----
  const weeks = useMemo(() => isoWeeksOfYear(year), [year]);
  const months = useMemo(() => monthGroups(weeks), [weeks]);
  const todayIdx = useMemo(
    () => currentWeekIndex(weeks, today),
    [weeks, today],
  );

  const allProjectRows: ProjectRow[] = useMemo(() => {
    const rows: ProjectRow[] = [];
    for (const slug of Object.keys(customers)) {
      const c = customers[slug];
      for (const p of c.projects) {
        rows.push({ customer: c.client, customerSlug: slug, project: p });
      }
    }
    // Primärt: leads sist (rank 1), allt annat först (rank 0).
    // Sekundärt: alfabetiskt på kund, sedan projektnamn.
    function statusRank(p: { status?: ProjectStatus }): number {
      return (p.status ?? "active") === "lead" ? 1 : 0;
    }
    rows.sort(
      (a, b) =>
        statusRank(a.project) - statusRank(b.project) ||
        a.customer.localeCompare(b.customer, "sv") ||
        a.project.name.localeCompare(b.project.name, "sv"),
    );
    return rows;
  }, [customers]);

  const projectRows: ProjectRow[] = useMemo(() => {
    return allProjectRows.filter((r) => {
      if (customerFilter && r.customerSlug !== customerFilter) return false;
      const status = (r.project.status ?? "active") as ProjectStatus;
      if (!statusFilter.has(status)) return false;
      return true;
    });
  }, [allProjectRows, customerFilter, statusFilter]);

  // Beläggning är alltid räknad mot ALLA projekt (oavsett filter) så att
  // siffrorna stämmer även när man filtrerar till en kund. Varje allokering
  // har egna start/slutdatum frikopplade från projektets.
  const workloadByMember = useMemo(
    () => computeWeeklyBookings(weeks, allProjectRows),
    [weeks, allProjectRows],
  );

  // Projekt som räknas mot beläggningen — både "active" och "lead". Listas
  // för inline-editorn när en personrad expanderas, så användaren kan koppla
  // allokeringar till både pågående och potentiella projekt.
  const activeProjectRows: ProjectRow[] = useMemo(() => {
    return allProjectRows.filter((r) => {
      const s = r.project.status ?? "active";
      return s === "active" || s === "lead";
    });
  }, [allProjectRows]);

  const customerOptions = useMemo(
    () =>
      Object.entries(customers)
        .map(([slug, c]) => ({ slug, name: c.client || slug }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [customers],
  );

  // Phases sorted in canonical order (Strategi → Content → Design → Utveckling)
  function sortedPhases(phases: ProjectPhase[]): ProjectPhase[] {
    return phases.slice().sort((a, b) => {
      const ai = phaseOrder.indexOf(a.type);
      const bi = phaseOrder.indexOf(b.type);
      return ai - bi;
    });
  }

  // The currently selected phase (resolved live so edits flow through)
  const selectedPhaseData = useMemo(() => {
    if (!selectedPhase) return null;
    const c = customers[selectedPhase.customerSlug];
    if (!c) return null;
    const p = c.projects.find((x) => x.id === selectedPhase.projectId);
    if (!p) return null;
    const ph = (p.phases ?? []).find((x) => x.id === selectedPhase.phaseId);
    if (!ph) return null;
    return { customer: c.client, project: p, phase: ph };
  }, [selectedPhase, customers]);

  const cssVars = {
    ["--label-w" as string]: `${LABEL_WIDTH}px`,
    ["--week-w" as string]: `${WEEK_WIDTH}px`,
    ["--phase-row-h" as string]: `${PHASE_ROW_HEIGHT}px`,
    ["--header-row-h" as string]: `${HEADER_ROW_HEIGHT}px`,
    ["--n-weeks" as string]: `${weeks.length}`,
  } as React.CSSProperties;

  return (
    <>
      <div className="page-toolbar">
        <div className="page-toolbar-inner">
          <SaveIndicator status={saveStatus} />

          <button
            type="button"
            className="icon-btn toolbar-refresh"
            onClick={() => loadCustomers("silent")}
            title="Ladda om data från servern (t.ex. efter JSON-edit i Codex)"
            aria-label="Ladda om data"
            disabled={saveStatus === "saving"}
          >
            <RefreshCw
              size={13}
              strokeWidth={2.25}
              aria-hidden
              className={saveStatus === "saving" ? "spin" : ""}
            />
          </button>

          <button
            type="button"
            className="icon-btn toolbar-undo"
            onClick={undo}
            disabled={undoDepth === 0}
            title="Ångra senaste ändringen (⌘Z) — gör om med ⇧⌘Z"
            aria-label="Ångra"
          >
            <Undo2 size={13} strokeWidth={2.25} aria-hidden />
          </button>

          <TeamAvailabilitySummary
            workloadByMember={workloadByMember}
            todayIdx={todayIdx}
            weeks={weeks}
          />

          <div className="filter-group">
            {projectStatusOrder.map((s) => {
              const on = statusFilter.has(s);
              return (
                <button
                  type="button"
                  key={s}
                  className={`filter-pill status-pill status-${s} ${
                    on ? "on" : ""
                  }`}
                  onClick={() => {
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(s)) next.delete(s);
                      else next.add(s);
                      return next;
                    });
                  }}
                  aria-pressed={on}
                >
                  {projectStatusLabel[s]}
                </button>
              );
            })}
          </div>

          <FilterDropdown
            label="Kund"
            value={customerFilter}
            onChange={setCustomerFilter}
            placeholder="Alla"
            options={customerOptions.map((c) => ({
              value: c.slug,
              label: c.name,
            }))}
          />

          <FilterDropdown
            label="Visar"
            value={assigneeFilter}
            onChange={(v) => setAssigneeFilter(v as CommentAssignee)}
            placeholder="Alla"
            options={[
              ...phaseOrder.map((t) => ({
                value: t,
                label: t,
                group: "Kategori",
              })),
              ...teamMembers.map((m) => ({
                value: m,
                label: m,
                group: "Person",
              })),
            ]}
          />

          <div className="filter-pill year-pill">
            <button
              type="button"
              className="year-arrow"
              aria-label="Föregående år"
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft size={14} strokeWidth={2.25} aria-hidden />
            </button>
            <span className="year-label">{year}</span>
            <button
              type="button"
              className="year-arrow"
              aria-label="Nästa år"
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
            </button>
          </div>

          <div className="toolbar-spacer" />

          <Link href="/notiser" className="btn btn-mute toolbar-btn">
            <Bell size={14} strokeWidth={2.25} aria-hidden /> Notiser
          </Link>

          <button
            type="button"
            className="btn toolbar-btn"
            onClick={() => setNewCustomerOpen(true)}
          >
            <Plus size={14} strokeWidth={2.25} aria-hidden /> Ny kund
          </button>
        </div>
      </div>

      <div className="main planering-main">
        {loading ? (
          <div className="empty-state large">Hämtar projekt…</div>
        ) : error ? (
          <div className="empty-state large">Kunde inte hämta data: {error}</div>
        ) : projectRows.length === 0 ? (
          <div className="empty-state large">
            {customerFilter ? (
              <>
                <p>
                  {customers[customerFilter]?.client ?? "Den här kunden"} har
                  inga projekt än.
                </p>
                <div className="empty-state-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setNewProjectFor(customerFilter)}
                  >
                    <Plus size={14} strokeWidth={2.25} aria-hidden /> Skapa första projektet
                  </button>
                  <button
                    type="button"
                    className="btn btn-mute"
                    onClick={() => setCustomerFilter("")}
                  >
                    Visa alla kunder
                  </button>
                </div>
              </>
            ) : allProjectRows.length === 0 ? (
              <>
                <p>Inga kunder eller projekt än.</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setNewCustomerOpen(true)}
                >
                  <Plus size={14} strokeWidth={2.25} aria-hidden /> Skapa första kunden
                </button>
              </>
            ) : (
              <p>Inga projekt matchar filtret.</p>
            )}
          </div>
        ) : (
          <div className="planering-scroll" style={cssVars}>
            {/* Month header */}
            <div className="planering-row planering-row-month">
              <div className="planering-row-label">
                <span className="planering-year-label">{year}</span>
              </div>
              <div className="planering-row-cells">
                {months.map((g) => (
                  <span
                    key={`m-${g.start}`}
                    className="planering-month-cell"
                    style={{ gridColumn: `${g.start + 1} / ${g.end + 2}` }}
                  >
                    {g.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Weeks header (clickable) */}
            <div className="planering-row planering-row-weeks">
              <div className="planering-row-label">
                <span className="planering-vecka-label">Vecka</span>
              </div>
              <div className="planering-row-cells">
                {weeks.map((w, i) => (
                  <button
                    type="button"
                    key={`w-${i}`}
                    className={`planering-week-cell clickable ${
                      i === todayIdx ? "current" : ""
                    } ${
                      weekPopover && weekPopover.week.weekNum === w.weekNum
                        ? "selected"
                        : ""
                    } ${pastWeekFadeClass(i, todayIdx)}`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setWeekPopover({
                        week: w,
                        weekIdx: i,
                        anchorX: rect.left + rect.width / 2,
                        anchorY: rect.bottom + 6,
                      });
                    }}
                    aria-label={`Visa vecka ${w.weekNum}`}
                    style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }}
                  >
                    {w.weekNum}
                  </button>
                ))}
                {todayIdx >= 0 && (
                  <div
                    className="planering-today-line"
                    style={{
                      gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                      gridRow: 1,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Project groups — varje projekt innehåller faser + allokeringar */}
            {projectRows.map((row) => (
              <ProjectGroup
                key={`${row.customerSlug}-${row.project.id}`}
                row={row}
                weeks={weeks}
                todayIdx={todayIdx}
                activeRows={activeProjectRows}
                onPatchPhase={(phaseId, patch) =>
                  patchPhase(row.customerSlug, row.project.id, phaseId, patch)
                }
                onSelectPhase={(phaseId) =>
                  setSelectedPhase({
                    customerSlug: row.customerSlug,
                    projectId: row.project.id,
                    phaseId,
                  })
                }
                onSelectProject={() =>
                  setSelectedProject({
                    customerSlug: row.customerSlug,
                    projectId: row.project.id,
                  })
                }
                onAddProject={() => setNewProjectFor(row.customerSlug)}
                onAddSprint={(type) =>
                  addSprint(row.customerSlug, row.project.id, type)
                }
                onSaveWeeklyNote={(yearWeek, text) =>
                  saveWeeklyNote(
                    row.customerSlug,
                    row.project.id,
                    yearWeek,
                    text,
                  )
                }
                onAddAllocation={addAllocation}
                onPatchAllocation={patchAllocation}
                onRemoveAllocation={removeAllocation}
                onAddPhase={addPhase}
                onRemovePhase={removePhase}
                onDuplicatePhase={duplicatePhase}
                onDuplicateAllocation={duplicateAllocation}
                assigneeFilter={assigneeFilter}
                sortedPhases={sortedPhases}
                selectedBar={selectedBar}
                onSelectBar={setSelectedBar}
                hoursUnit={hoursUnit}
                onSetHoursUnit={changeHoursUnit}
                workloadByMember={workloadByMember}
              />
            ))}

          </div>
        )}
      </div>

      {selectedPhase && selectedPhaseData && (
        <PhaseInlinePopover
          data={selectedPhaseData}
          onClose={() => setSelectedPhase(null)}
          onPatchPhase={(patch) =>
            patchPhase(
              selectedPhase.customerSlug,
              selectedPhase.projectId,
              selectedPhase.phaseId,
              patch,
            )
          }
          onRemovePhase={() => {
            removePhase(
              selectedPhase.customerSlug,
              selectedPhase.projectId,
              selectedPhase.phaseId,
            );
            setSelectedPhase(null);
          }}
        />
      )}

      {selectedProject &&
        (() => {
          const c = customers[selectedProject.customerSlug];
          const p = c?.projects.find((x) => x.id === selectedProject.projectId);
          if (!c || !p) return null;
          return (
            <ProjectPanel
              customer={c}
              customerSlug={selectedProject.customerSlug}
              project={p}
              onClose={() => setSelectedProject(null)}
              onPatchProject={(patch) =>
                patchProject(
                  selectedProject.customerSlug,
                  selectedProject.projectId,
                  patch,
                )
              }
              onPatchCustomer={(patch) =>
                patchCustomer(selectedProject.customerSlug, patch)
              }
              onDeleteProject={() => {
                if (
                  !window.confirm(
                    `Ta bort projektet "${p.name || "(utan namn)"}" permanent?`,
                  )
                )
                  return;
                deleteProject(
                  selectedProject.customerSlug,
                  selectedProject.projectId,
                );
                setSelectedProject(null);
              }}
            />
          );
        })()}

      {newProjectFor && (
        <NewProjectForm
          customerName={customers[newProjectFor]?.client ?? ""}
          onClose={() => setNewProjectFor(null)}
          onCreate={(name) => {
            addProjectToCustomer(newProjectFor, name);
            setNewProjectFor(null);
          }}
        />
      )}

      {newCustomerOpen && (
        <NewCustomerForm
          onClose={() => setNewCustomerOpen(false)}
          onCreate={async (name) => {
            await addCustomer(name);
            setNewCustomerOpen(false);
          }}
        />
      )}

      {weekPopover && (
        <WeekPopover
          week={weekPopover.week}
          weekIdx={weekPopover.weekIdx}
          anchorX={weekPopover.anchorX}
          anchorY={weekPopover.anchorY}
          rows={projectRows}
          workloadByMember={workloadByMember}
          assigneeFilter={assigneeFilter}
          onClose={() => setWeekPopover(null)}
        />
      )}
    </>
  );
}

// ---- Legend -----------------------------------------------------------------

interface FilterOption {
  value: string;
  label: string;
  group?: string;
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
  placeholder = "Alla",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder?: string;
}) {
  // Group options by their `group` field while preserving order
  const groups = new Map<string | undefined, FilterOption[]>();
  for (const opt of options) {
    const key = opt.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  const active = value !== "";
  const selected = options.find((o) => o.value === value);
  const displayValue = selected ? selected.label : placeholder;
  return (
    <label className={`filter-pill filter-dropdown ${active ? "on" : ""}`}>
      <span className="filter-pill-label">{label}</span>
      <span className="filter-pill-value">{displayValue}</span>
      <span className="filter-pill-chevron" aria-hidden>
        <ChevronDown size={12} strokeWidth={2.25} />
      </span>
      <select
        className="filter-pill-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        <option value="">{placeholder}</option>
        {Array.from(groups.entries()).map(([groupName, opts]) =>
          groupName ? (
            <optgroup key={groupName} label={groupName}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    </label>
  );
}

/**
 * Kompakt toolbar-widget med per-person bokade timmar för innevarande vecka.
 * Visas högst upp till vänster i toolbaren och uppdateras automatiskt
 * baserat på vilken vecka som är aktuell idag.
 */
function TeamAvailabilitySummary({
  workloadByMember,
  todayIdx,
  weeks,
}: {
  workloadByMember: Map<TeamMember, WeekBooking[]>;
  todayIdx: number;
  weeks: WeekInfo[];
}) {
  // Om dagens datum inte ligger inom det synliga året — göm widgeten
  if (todayIdx < 0 || !weeks[todayIdx]) return null;
  const currentWeek = weeks[todayIdx];
  return (
    <div className="team-summary" title="Bokade timmar denna vecka">
      <span className="team-summary-label">v{currentWeek.weekNum}</span>
      {teamMembers.map((m) => {
        const bookings = workloadByMember.get(m);
        const hours = Math.round(bookings?.[todayIdx]?.hours ?? 0);
        const isOver = hours > WEEKLY_CAPACITY;
        const isFull = hours >= WEEKLY_CAPACITY && !isOver;
        const firstName = m.split(" ")[0];
        return (
          <span
            key={`avail-${m}`}
            className={`team-summary-chip ${isOver ? "over" : isFull ? "full" : ""}`}
            title={`${m} — ${hours}h bokade v${currentWeek.weekNum}`}
          >
            <span className="team-summary-name">{firstName}</span>
            <span className="team-summary-hours">{hours}h</span>
          </span>
        );
      })}
    </div>
  );
}

function SaveIndicator({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Sparar"
      : status === "saved" ? "Sparat"
        : "Sparafel";
  return (
    <span className={`save-indicator status-${status}`} aria-live="polite">
      <span className="save-dot" />
      {label}
    </span>
  );
}

// ---- Project group ---------------------------------------------------------

function ProjectGroup({
  row,
  weeks,
  todayIdx,
  activeRows,
  onPatchPhase,
  onSelectPhase,
  onSelectProject,
  onAddProject,
  onAddSprint,
  onSaveWeeklyNote,
  onAddAllocation,
  onPatchAllocation,
  onRemoveAllocation,
  onAddPhase,
  onRemovePhase,
  onDuplicatePhase,
  onDuplicateAllocation,
  assigneeFilter,
  sortedPhases,
  selectedBar,
  onSelectBar,
  hoursUnit,
  onSetHoursUnit,
  workloadByMember,
}: {
  row: ProjectRow;
  weeks: WeekInfo[];
  todayIdx: number;
  activeRows: ProjectRow[];
  onPatchPhase: (phaseId: string, patch: Partial<ProjectPhase>) => void;
  onSelectPhase: (phaseId: string) => void;
  onSelectProject: () => void;
  onAddProject: () => void;
  onAddSprint: (type: PhaseType) => void;
  onSaveWeeklyNote: (yearWeek: string, text: string) => void;
  onAddAllocation: (slug: string, projectId: string, allocation: ProjectAllocation) => void;
  onPatchAllocation: (
    slug: string,
    projectId: string,
    allocationId: string,
    patch: Partial<ProjectAllocation>,
  ) => void;
  onRemoveAllocation: (slug: string, projectId: string, allocationId: string) => void;
  onAddPhase: (slug: string, projectId: string, phase: ProjectPhase) => void;
  onRemovePhase: (slug: string, projectId: string, phaseId: string) => void;
  onDuplicatePhase: (slug: string, projectId: string, phaseId: string) => void;
  onDuplicateAllocation: (
    slug: string,
    projectId: string,
    allocationId: string,
  ) => string | null;
  assigneeFilter: CommentAssignee;
  sortedPhases: (phases: ProjectPhase[]) => ProjectPhase[];
  selectedBar: SelectedBar | null;
  onSelectBar: (bar: SelectedBar | null) => void;
  hoursUnit: HoursUnit;
  onSetHoursUnit: (unit: HoursUnit) => void;
  workloadByMember: Map<TeamMember, WeekBooking[]>;
}) {
  const phases = sortedPhases(row.project.phases ?? []);
  const allocations = row.project.allocations ?? [];
  const [editingAllocation, setEditingAllocation] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Quick-create-popover: när användaren klickar på en empty vecka i en fas-rad
  // öppnas en liten popup med fas-typ-chips. Position ankras till klick-punkten.
  // Hover-affordance ("+") finns lokalt i varje PhaseTimelineRow.
  const [createPopover, setCreatePopover] = useState<{
    weekIdx: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  function handleCreatePhase(type: PhaseType, weekIdx: number) {
    const startISO = weeks[weekIdx].monday.toISOString().slice(0, 10);
    const endISO = weeks[weekIdx].sunday.toISOString().slice(0, 10);
    const np = newPhase(type);
    np.startDate = startISO;
    np.endDate = endISO;
    onAddPhase(row.customerSlug, row.project.id, np);
    setCreatePopover(null);
  }

  // Default-datum för nya allokeringar: projektets datum, annars idag→år-slut
  function defaultAllocDates(): { startDate: string; endDate: string } {
    if (row.project.startDate && row.project.endDate) {
      return {
        startDate: row.project.startDate,
        endDate: row.project.endDate,
      };
    }
    const today = new Date().toISOString().slice(0, 10);
    const yearEnd = new Date(weeks[weeks.length - 1].sunday)
      .toISOString()
      .slice(0, 10);
    return {
      startDate: row.project.startDate || today,
      endDate: row.project.endDate || yearEnd,
    };
  }

  function handleAddPerson() {
    // Hitta första medlem som inte redan har allokering här — annars första
    const allocated = new Set(allocations.map((a) => a.member));
    const member =
      teamMembers.find((m) => !allocated.has(m)) ?? teamMembers[0];
    const { startDate, endDate } = defaultAllocDates();
    const allocation = newAllocation(member, startDate, endDate, 0);
    onAddAllocation(row.customerSlug, row.project.id, allocation);
    setEditingAllocation(allocation.id);
  }
  return (
    <>
      <div
        className={`planering-row planering-row-project-header ${
          collapsed ? "collapsed" : ""
        }`}
      >
        <div className="planering-row-label project-header-label">
          <button
            type="button"
            className="project-header-collapse"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Visa projektets innehåll" : "Dölj projektets innehåll"}
            title={collapsed ? "Visa allt" : "Dölj"}
          >
            <ChevronDown
              size={12}
              strokeWidth={2.25}
              style={{
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform var(--t-fast)",
              }}
              aria-hidden
            />
          </button>
          <button
            type="button"
            className="project-header-link"
            onClick={onSelectProject}
          >
            <span className="row-customer">{row.customer}</span>
            <span className="row-project">
              {row.project.name || "(utan namn)"}
              {row.project.status && row.project.status !== "active" && (
                <span
                  className={`project-status-pill status-${row.project.status}`}
                >
                  {projectStatusLabel[row.project.status]}
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            className="project-header-add"
            onClick={onAddProject}
            title={`Lägg till nytt projekt under ${row.customer}`}
            aria-label="Nytt projekt"
          >
            <Plus size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
        <div className="planering-row-cells project-header-cells">
          {todayIdx >= 0 && (
            <div
              className="planering-today-line"
              style={{
                gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                gridRow: 1,
              }}
            />
          )}
        </div>
      </div>

      {createPopover && (
        <QuickCreatePopover
          weekIdx={createPopover.weekIdx}
          week={weeks[createPopover.weekIdx]}
          anchorX={createPopover.anchorX}
          anchorY={createPopover.anchorY}
          onClose={() => setCreatePopover(null)}
          onCreatePhase={(type) =>
            handleCreatePhase(type, createPopover.weekIdx)
          }
        />
      )}
      {!collapsed && (phases.length === 0 ? (
        <EmptyPhaseRow
          weeks={weeks}
          todayIdx={todayIdx}
          onOpenCreatePopover={(weekIdx, anchorX, anchorY) =>
            setCreatePopover({ weekIdx, anchorX, anchorY })
          }
        />
      ) : (
        phases.map((phase) => (
          <PhaseTimelineRow
            key={phase.id}
            phase={phase}
            weeks={weeks}
            todayIdx={todayIdx}
            weeklyNotes={row.project.weeklyNotes ?? []}
            onPatch={(patch) => onPatchPhase(phase.id, patch)}
            onSelect={() => onSelectPhase(phase.id)}
            onAddSprint={() => onAddSprint(phase.type)}
            onSaveWeeklyNote={onSaveWeeklyNote}
            assigneeFilter={assigneeFilter}
            onOpenCreatePopover={(weekIdx, anchorX, anchorY) =>
              setCreatePopover({ weekIdx, anchorX, anchorY })
            }
            onRemovePhase={() =>
              onRemovePhase(row.customerSlug, row.project.id, phase.id)
            }
            onDuplicatePhase={() =>
              onDuplicatePhase(row.customerSlug, row.project.id, phase.id)
            }
            selected={
              selectedBar?.kind === "phase" &&
              selectedBar.customerSlug === row.customerSlug &&
              selectedBar.projectId === row.project.id &&
              selectedBar.id === phase.id
            }
            onSelectBar={() =>
              onSelectBar({
                kind: "phase",
                customerSlug: row.customerSlug,
                projectId: row.project.id,
                id: phase.id,
              })
            }
          />
        ))
      ))}

      {/* Allokeringar — en rad per person på projektet, med dragbar stapel.
          Grupperas per person (samma namn alltid under varandra), inom gruppen
          sorteras på startdatum. */}
      {!collapsed && allocations
        .slice()
        .sort((a, b) => {
          const byMember = a.member.localeCompare(b.member, "sv");
          if (byMember !== 0) return byMember;
          return a.startDate.localeCompare(b.startDate);
        })
        .map((allocation) => {
          const ma: MemberAlloc = {
            customer: row.customer,
            customerSlug: row.customerSlug,
            project: row.project,
            allocation,
          };
          const isEditing = editingAllocation === allocation.id;
          // Samma logik som för fas-rader: när assignee-filtret pekar på en
          // person dimmas övriga personers allokeringar. Fas-typsfilter
          // (Strategi/Content/…) lämnar allokeringar orörda eftersom de
          // saknar fas-typ.
          const dimmed =
            !!assigneeFilter &&
            !isPhaseCategoryAssignee(assigneeFilter) &&
            allocation.member !== assigneeFilter;
          return (
            <TeamAllocRow
              key={`alloc-${allocation.id}`}
              ma={ma}
              weeks={weeks}
              todayIdx={todayIdx}
              isEditing={isEditing}
              dimmed={dimmed}
              onOpenEdit={() => setEditingAllocation(allocation.id)}
              onCloseEdit={() => setEditingAllocation(null)}
              onPatch={(patch) =>
                onPatchAllocation(
                  row.customerSlug,
                  row.project.id,
                  allocation.id,
                  patch,
                )
              }
              onRemove={() => {
                onRemoveAllocation(
                  row.customerSlug,
                  row.project.id,
                  allocation.id,
                );
                setEditingAllocation(null);
              }}
              onDuplicate={() => {
                const copyId = onDuplicateAllocation(
                  row.customerSlug,
                  row.project.id,
                  allocation.id,
                );
                setEditingAllocation(copyId);
              }}
              selected={
                selectedBar?.kind === "alloc" &&
                selectedBar.customerSlug === row.customerSlug &&
                selectedBar.projectId === row.project.id &&
                selectedBar.id === allocation.id
              }
              onSelectBar={() =>
                onSelectBar({
                  kind: "alloc",
                  customerSlug: row.customerSlug,
                  projectId: row.project.id,
                  id: allocation.id,
                })
              }
              hoursUnit={hoursUnit}
              onSetHoursUnit={onSetHoursUnit}
              bookings={workloadByMember.get(allocation.member)}
            />
          );
        })}

      {/* Klickbar rad för att lägga till en person på projektet. */}
      {!collapsed && (
        <div className="planering-row planering-row-add-person">
          <button
            type="button"
            className="planering-row-label add-person-btn"
            onClick={handleAddPerson}
          >
            <Plus size={11} strokeWidth={2.25} aria-hidden />
            <span>Lägg till person</span>
          </button>
          <div className="planering-row-cells add-person-cells">
            {todayIdx >= 0 && (
              <div
                className="planering-today-line"
                style={{
                  gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                  gridRow: 1,
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---- Quick-create popover --------------------------------------------------

/**
 * Tom fas-rad som visas när projektet saknar faser. Spegelar
 * PhaseTimelineRow:s hover-+-affordans utan att rita någon stapel — så
 * användaren kan klicka var som helst i veckorastret och öppna
 * QuickCreatePopover för att skapa sin första fas.
 */
function EmptyPhaseRow({
  weeks,
  todayIdx,
  onOpenCreatePopover,
}: {
  weeks: WeekInfo[];
  todayIdx: number;
  onOpenCreatePopover: (weekIdx: number, anchorX: number, anchorY: number) => void;
}) {
  const [hoveredCreateWeek, setHoveredCreateWeek] = useState<number | null>(null);
  return (
    <div className="planering-row planering-row-phase planering-row-empty-phases">
      <div className="planering-row-label phase-row-label phase-row-label-empty">
        {/* Avsiktligt tom — vi vill bara ha en rastad rad att hovra i. */}
      </div>
      <div
        className="planering-row-cells phase-row-cells phase-row-cells-hoverable"
        onMouseMove={(e) => {
          if (e.target !== e.currentTarget) {
            setHoveredCreateWeek(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.floor(x / WEEK_WIDTH);
          if (idx >= 0 && idx < weeks.length) setHoveredCreateWeek(idx);
          else setHoveredCreateWeek(null);
        }}
        onMouseLeave={() => setHoveredCreateWeek(null)}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.floor(x / WEEK_WIDTH);
          if (idx < 0 || idx >= weeks.length) return;
          onOpenCreatePopover(idx, e.clientX, e.clientY + 12);
        }}
      >
        {todayIdx >= 0 && (
          <div
            className="planering-today-line"
            style={{
              gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
              gridRow: 1,
            }}
          />
        )}
        {hoveredCreateWeek !== null && (
          <div
            className="cell-create-plus"
            style={{
              gridColumn: `${hoveredCreateWeek + 1} / ${hoveredCreateWeek + 2}`,
              gridRow: 1,
            }}
            aria-hidden
          >
            <Plus size={11} strokeWidth={2.5} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Liten popover som öppnas vid klick på en tom cell i project-header.
 * Visar fas-typ-chips inline så användaren slipper öppna ProjectPanel
 * för att skapa en fas. Ankrar till klickpositionen med smart flip.
 */
function QuickCreatePopover({
  weekIdx,
  week,
  anchorX,
  anchorY,
  onClose,
  onCreatePhase,
}: {
  weekIdx: number;
  week: WeekInfo;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
  onCreatePhase: (type: PhaseType) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const popoverWidth = 260;
  const margin = 12;
  const maxLeft =
    typeof window !== "undefined"
      ? window.innerWidth - popoverWidth - margin
      : 0;
  const left = Math.max(margin, Math.min(anchorX - popoverWidth / 2, maxLeft));
  const popoverHeight = 200;
  const flipUp =
    typeof window !== "undefined" &&
    anchorY + popoverHeight > window.innerHeight - margin;
  const top = flipUp ? anchorY - popoverHeight - 24 : anchorY;

  // Ohanterad parameter, men finns för framtida actions (allokering med datum)
  void weekIdx;

  return (
    <>
      <div className="quick-popover-backdrop" onClick={onClose} />
      <div
        className="quick-popover"
        style={{ top, left, width: popoverWidth }}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quick-popover-header">
          <div className="quick-popover-title">Skapa fas</div>
          <div className="quick-popover-sub">
            startar v{week.weekNum} · {fmtDay(week.monday)}
          </div>
        </div>
        <div className="quick-popover-chips">
          {phaseOrder.map((t) => (
            <button
              key={t}
              type="button"
              className={`quick-popover-chip phase-swatch-${t.toLowerCase()}`}
              onClick={() => onCreatePhase(t)}
            >
              <Plus size={11} strokeWidth={2.25} aria-hidden />
              <span>{t}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ---- New project / new customer mini-forms ---------------------------------

function NewProjectForm({
  customerName,
  onClose,
  onCreate,
}: {
  customerName: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-form"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-form-title">
          Nytt projekt under {customerName}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="panel-text-input"
          placeholder="Projektnamn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              onCreate(name);
            }
          }}
        />
        <div className="modal-form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => onCreate(name)}
            disabled={!name.trim()}
          >
            Skapa
          </button>
          <button type="button" className="btn btn-mute" onClick={onClose}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

function NewCustomerForm({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
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
  async function submit() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    await onCreate(name);
    setSubmitting(false);
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-form"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-form-title">Ny kund</div>
        <input
          ref={inputRef}
          type="text"
          className="panel-text-input"
          placeholder="Kundens namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="modal-form-actions">
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Skapar…" : "Skapa"}
          </button>
          <button type="button" className="btn btn-mute" onClick={onClose}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Phase row with drag ---------------------------------------------------

function PhaseTimelineRow({
  phase,
  weeks,
  todayIdx,
  weeklyNotes,
  onPatch,
  onSelect,
  onAddSprint,
  onSaveWeeklyNote,
  assigneeFilter,
  onOpenCreatePopover,
  onRemovePhase,
  onDuplicatePhase,
  selected,
  onSelectBar,
}: {
  phase: ProjectPhase;
  weeks: WeekInfo[];
  todayIdx: number;
  weeklyNotes: WeeklyNote[];
  onPatch: (patch: Partial<ProjectPhase>) => void;
  onSelect: () => void;
  onAddSprint: () => void;
  onSaveWeeklyNote: (yearWeek: string, text: string) => void;
  assigneeFilter: CommentAssignee;
  onOpenCreatePopover: (weekIdx: number, anchorX: number, anchorY: number) => void;
  onRemovePhase: () => void;
  onDuplicatePhase: () => void;
  /** Markerad stapel — tar emot piltangenter. */
  selected: boolean;
  onSelectBar: () => void;
}) {
  const { preview, dragging, precise, startDrag } = useTimelineDrag({
    startDate: phase.startDate,
    endDate: phase.endDate,
    onCommit: (r) => onPatch({ startDate: r.startDate, endDate: r.endDate }),
    onClick: onSelect,
    onDragStart: onSelectBar,
  });
  const [hovered, setHovered] = useState(false);
  const [hoveredWeekIdx, setHoveredWeekIdx] = useState<number | null>(null);
  const [hoveredCreateWeek, setHoveredCreateWeek] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stäng kontextmenyn vid Esc eller klick utanför
  useEffect(() => {
    if (!contextMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    function onDocClick() {
      setContextMenu(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
    };
  }, [contextMenu]);

  const effectiveStart = preview?.startDate ?? phase.startDate;
  const effectiveEnd = preview?.endDate ?? phase.endDate;

  const start = parseISODate(effectiveStart);
  const end = parseISODate(effectiveEnd);
  const range = start && end ? dateRangeToWeeks(weeks, start, end) : null;

  // Dim-logik: bara kategori-filter (Strategi/Content/…) dimmar fas-rader.
  // Person-filter låter fas-staplarna vara orörda — vem som jobbar lever
  // numera under allokeringsraderna och dimmas där istället.
  const dimmed =
    !!assigneeFilter &&
    isPhaseCategoryAssignee(assigneeFilter) &&
    phase.type !== assigneeFilter;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Endast vänster musknapp triggar drag/select. Höger musknapp lämnas
    // åt onContextMenu så kontextmenyn kan öppnas utan att stapeln också
    // tolkar det som ett klick.
    if (e.button !== 0) return;
    onSelectBar();
    if (!phase.startDate || !phase.endDate) {
      // No range yet; treat as click → open panel for manual edit
      onSelect();
      return;
    }
    const target = e.target as HTMLElement;
    let mode: DragMode = "move";
    if (target.classList.contains("phase-resize-left")) mode = "resize-left";
    else if (target.classList.contains("phase-resize-right"))
      mode = "resize-right";
    startDrag(e, mode);
  }

  const previewDateLabel = preview
    ? `${formatPanelDateRange(preview.startDate, preview.endDate)} · ${weekSpan(
        preview.startDate,
        preview.endDate,
      )} v${precise ? " · dag" : ""}`
    : "";

  return (
    <div
      className={`planering-row planering-row-phase ${dimmed ? "dimmed" : ""}`}
    >
      <div className="planering-row-label phase-row-label">
        <span className="phase-row-type">{phase.type}</span>
        <button
          type="button"
          className="phase-row-add"
          onClick={(e) => {
            e.stopPropagation();
            onAddSprint();
          }}
          title={`Lägg till en ${phase.type}-sprint till`}
          aria-label={`Lägg till ny ${phase.type}-sprint`}
        >
          <Plus size={12} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      <div
        className="planering-row-cells phase-row-cells phase-row-cells-hoverable"
        onMouseMove={(e) => {
          // Visa + endast när cursoren är över EMPTY area (inte över barren)
          if (e.target !== e.currentTarget) {
            setHoveredCreateWeek(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.floor(x / WEEK_WIDTH);
          if (idx >= 0 && idx < weeks.length) {
            setHoveredCreateWeek(idx);
          } else {
            setHoveredCreateWeek(null);
          }
        }}
        onMouseLeave={() => setHoveredCreateWeek(null)}
        onClick={(e) => {
          // Klick på empty area (inte på bar) → öppna create-popover
          if (e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.floor(x / WEEK_WIDTH);
          if (idx < 0 || idx >= weeks.length) return;
          onOpenCreatePopover(idx, e.clientX, e.clientY + 12);
        }}
      >
        {todayIdx >= 0 && (
          <div
            className="planering-today-line"
            style={{
              gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
              gridRow: 1,
            }}
          />
        )}

        {hoveredCreateWeek !== null && (
          <div
            className="cell-create-plus"
            style={{
              gridColumn: `${hoveredCreateWeek + 1} / ${hoveredCreateWeek + 2}`,
              gridRow: 1,
            }}
            aria-hidden
          >
            <Plus size={11} strokeWidth={2.5} />
          </div>
        )}

        {range ? (
          <div
            className={`phase-bar-wrapper phase-${phase.type.toLowerCase()} ${pastWeekFadeClass(range.endIdx, todayIdx)} ${
              selected ? "is-selected" : ""
            } ${dragging ? "is-dragging" : ""}`}
            style={{
              gridColumn: `${range.startIdx + 1} / ${range.endIdx + 2}`,
              gridRow: 1,
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
            onPointerDown={onPointerDown}
            title={BAR_HINT}
            onPointerMove={(e) => {
              // Track which week the cursor is inside (within the bar) so
              // the hover tooltip can offer to take a note for that week.
              // Själva draget lyssnar på window och behöver inget här.
              if (range && !dragging) {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = e.clientX - rect.left;
                const wInBar = Math.max(
                  0,
                  Math.floor(relX / WEEK_WIDTH),
                );
                const abs = Math.min(
                  weeks.length - 1,
                  Math.max(0, range.startIdx + wInBar),
                );
                setHoveredWeekIdx(abs);
              }
            }}
            onMouseEnter={() => {
              if (hoverHideTimerRef.current) {
                clearTimeout(hoverHideTimerRef.current);
                hoverHideTimerRef.current = null;
              }
              setHovered(true);
            }}
            onMouseLeave={() => {
              // Small delay so the cursor can move from bar to tooltip
              // (which lives above with an 8px gap) without flicker.
              hoverHideTimerRef.current = setTimeout(() => {
                setHovered(false);
                setHoveredWeekIdx(null);
              }, 140);
            }}
          >
            <div className="phase-resize-left" aria-hidden />
            <div className="phase-bar-body" />
            <div className="phase-resize-right" aria-hidden />
            {preview && (
              <div className="phase-preview-label">{previewDateLabel}</div>
            )}
            {hovered && !dragging && (
              <PhaseHoverTooltip
                phase={phase}
                weeks={weeks}
                hoveredWeekIdx={hoveredWeekIdx ?? range.startIdx}
                weeklyNotes={weeklyNotes}
                onSaveWeeklyNote={onSaveWeeklyNote}
                onTooltipEnter={() => {
                  if (hoverHideTimerRef.current) {
                    clearTimeout(hoverHideTimerRef.current);
                    hoverHideTimerRef.current = null;
                  }
                  setHovered(true);
                }}
                onTooltipLeave={() => {
                  hoverHideTimerRef.current = setTimeout(() => {
                    setHovered(false);
                    setHoveredWeekIdx(null);
                  }, 140);
                }}
              />
            )}
          </div>
        ) : (
          <button
            type="button"
            className="phase-empty-track"
            onClick={onSelect}
            style={{ gridColumn: `1 / ${weeks.length + 1}`, gridRow: 1 }}
            aria-label="Öppna fas för att sätta datum"
          />
        )}
      </div>

      {contextMenu && (
        <div
          className="phase-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="phase-context-item"
            onClick={() => {
              onSelect();
              setContextMenu(null);
            }}
          >
            Öppna fas
          </button>
          <button
            type="button"
            className="phase-context-item"
            onClick={() => {
              onDuplicatePhase();
              setContextMenu(null);
            }}
          >
            Duplicera fas
          </button>
          <button
            type="button"
            className="phase-context-item danger"
            onClick={() => {
              onRemovePhase();
              setContextMenu(null);
            }}
          >
            Ta bort fas
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Phase hover tooltip ---------------------------------------------------

function PhaseHoverTooltip({
  phase,
  weeks,
  hoveredWeekIdx,
  weeklyNotes,
  onSaveWeeklyNote,
  onTooltipEnter,
  onTooltipLeave,
}: {
  phase: ProjectPhase;
  weeks: WeekInfo[];
  hoveredWeekIdx: number;
  weeklyNotes: WeeklyNote[];
  onSaveWeeklyNote: (yearWeek: string, text: string) => void;
  onTooltipEnter: () => void;
  onTooltipLeave: () => void;
}) {
  const notes = (phase.notes ?? "").trim();
  const range = formatPanelDateRange(phase.startDate, phase.endDate);

  const week = weeks[hoveredWeekIdx];
  const yearWeek = week ? isoWeekString(week.monday) : "";
  const existingNote = yearWeek
    ? weeklyNotes.find((n) => n.yearWeek === yearWeek)
    : undefined;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(existingNote?.text ?? "");
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // Flip tooltip below the bar when det inte finns plats ovanför.
  // Mäter parent-rect (fas-stapelns position) och checkar mot sticky-headers
  // + viewport-top. Om för litet utrymme uppåt — vänd nedåt.
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [flipBelow, setFlipBelow] = useState(false);
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const tooltipHeight = el.offsetHeight;
    // ~120px täcker toolbar (57) + sticky månads/vecko-headers (64).
    const minTopSpace = 120;
    setFlipBelow(parentRect.top - tooltipHeight - 12 < minTopSpace);
  }, [hoveredWeekIdx, notes.length, existingNote?.text]);

  // Reset the editing draft when the hovered week changes (so we don't
  // accidentally save a draft against the wrong week).
  useEffect(() => {
    setDraft(existingNote?.text ?? "");
    setEditing(false);
  }, [yearWeek, existingNote?.id, existingNote?.text]);

  // Focus the textarea right after it appears.
  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus();
      const len = textRef.current.value.length;
      textRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  function commit() {
    if (!yearWeek) {
      setEditing(false);
      return;
    }
    const next = draft.trim();
    const current = existingNote?.text ?? "";
    if (next !== current) {
      onSaveWeeklyNote(yearWeek, next);
    }
    setEditing(false);
  }

  // Notes-preview: max 4 rader så tooltipen inte blir för hög.
  const notesPreview = notes
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, 4);
  const notesOverflow =
    notes.split("\n").filter((line) => line.trim().length > 0).length - notesPreview.length;

  return (
    <div
      ref={tooltipRef}
      className={`phase-hover-tooltip ${flipBelow ? "below" : ""}`}
      role="tooltip"
      onMouseEnter={onTooltipEnter}
      onMouseLeave={onTooltipLeave}
    >
      <div className="phase-hover-header">
        <span
          className={`legend-dot phase-swatch-${phase.type.toLowerCase()}`}
          aria-hidden
        />
        <span className="phase-hover-type">{phase.type}</span>
        {range && <span className="phase-hover-range">{range}</span>}
      </div>

      {/* Notes-preview: snabbt utdrag av fasens fritext-anteckningar.
          Användaren får värde av hovern utan att behöva klicka. */}
      {notesPreview.length > 0 ? (
        <div className="phase-hover-notes">
          {notesPreview.map((line, i) => (
            <p key={i} className="phase-hover-notes-line">
              {line}
            </p>
          ))}
          {notesOverflow > 0 && (
            <p className="phase-hover-notes-overflow">
              +{notesOverflow} {notesOverflow === 1 ? "rad till" : "rader till"}
            </p>
          )}
        </div>
      ) : (
        <p className="phase-hover-notes-empty">Inga anteckningar än</p>
      )}

      {week && (
        <div className="phase-hover-weeknote">
          <div className="phase-hover-weeknote-head">
            <span className="phase-hover-weeknote-label">Vecka {week.weekNum}</span>
            {!editing && (
              <button
                type="button"
                className="phase-hover-weeknote-btn"
                onClick={() => setEditing(true)}
                title={existingNote ? "Redigera veckonotering" : "Lägg till veckonotering"}
                aria-label={existingNote ? "Redigera veckonotering" : "Lägg till veckonotering"}
              >
                {existingNote ? (
                  <Pencil size={12} strokeWidth={2.25} aria-hidden />
                ) : (
                  <Plus size={12} strokeWidth={2.25} aria-hidden />
                )}
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              ref={textRef}
              className="phase-hover-weeknote-input"
              value={draft}
              rows={2}
              placeholder="Skriv en notering för veckan…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(existingNote?.text ?? "");
                  setEditing(false);
                }
              }}
            />
          ) : existingNote ? (
            <p className="phase-hover-weeknote-text">{existingNote.text}</p>
          ) : (
            <p className="phase-hover-weeknote-empty">Ingen notering än.</p>
          )}
        </div>
      )}

    </div>
  );
}

// ---- Phase panel (comments editor) -----------------------------------------

/**
 * Inline popover som ersätter PhasePanel (stor slide-in från höger).
 * Centrerad i viewporten, ~440px bred — håller hela fas-redigeringen
 * (datum, kommentarer/uppgifter, delete) inline utan att rycka användaren
 * ur arbetsytan. Samma mönster som AllocPopover.
 */
function PhaseInlinePopover({
  data,
  onClose,
  onPatchPhase,
  onRemovePhase,
}: {
  data: { customer: string; project: Project; phase: ProjectPhase };
  onClose: () => void;
  onPatchPhase: (patch: Partial<ProjectPhase>) => void;
  onRemovePhase: () => void;
}) {
  const { customer, project, phase } = data;
  // Local draft för smooth typing — debouncas till parent via onPatchPhase.
  const [draftNotes, setDraftNotes] = useState(phase.notes ?? "");

  // Synka in om en annan vy ändrar fasen samtidigt.
  useEffect(() => {
    setDraftNotes(phase.notes ?? "");
  }, [phase.id, phase.notes]);

  // Debounced save: skriv tillbaka 400ms efter sista tangenttryck.
  useEffect(() => {
    if ((phase.notes ?? "") === draftNotes) return;
    const t = setTimeout(() => {
      onPatchPhase({ notes: draftNotes });
    }, 400);
    return () => clearTimeout(t);
  }, [draftNotes, phase.notes, onPatchPhase]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="alloc-popover-backdrop" onClick={onClose} />
      <div
        className="phase-inline-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="phase-inline-header">
          <div className="phase-inline-titlewrap">
            <div className="phase-inline-eyebrow">
              <span
                className={`legend-dot phase-swatch-${phase.type.toLowerCase()}`}
                aria-hidden
              />
              <span>{phase.type}</span>
            </div>
            <div className="phase-inline-title">
              {customer} · {project.name || "(utan namn)"}
            </div>
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

        <div className="phase-inline-dates">
          <DatePicker
            value={phase.startDate}
            onChange={(v) => {
              const patch: Partial<ProjectPhase> = { startDate: v };
              if (v && phase.endDate && v > phase.endDate) patch.endDate = v;
              onPatchPhase(patch);
            }}
            ariaLabel="Fasens startdatum"
            placeholder="Start"
            size="compact"
          />
          <span className="phase-inline-dash" aria-hidden>–</span>
          <DatePicker
            value={phase.endDate}
            onChange={(v) => {
              const patch: Partial<ProjectPhase> = { endDate: v };
              if (v && phase.startDate && v < phase.startDate)
                patch.startDate = v;
              onPatchPhase(patch);
            }}
            ariaLabel="Fasens slutdatum"
            placeholder="Slut"
            size="compact"
          />
        </div>

        <div className="phase-inline-body">
          <textarea
            className="phase-inline-notes"
            placeholder="Anteckningar om fasen…"
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            autoFocus
          />
        </div>

        <div className="phase-inline-footer">
          <button
            type="button"
            className="btn btn-mute danger small"
            onClick={() => {
              onRemovePhase();
              onClose();
            }}
          >
            Ta bort fas
          </button>
          <button type="button" className="btn small" onClick={onClose}>
            Klar
          </button>
        </div>
      </div>
    </>
  );
}


// ---- Week panel (read-only summary) ----------------------------------------

interface PhaseInWeek {
  customer: string;
  customerSlug: string;
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
}

/**
 * Litet kontextuellt popover som ankrar till en klickad vecka-cell. Visar
 * KPI:er för veckan — total beläggning, per-person breakdown och antal
 * projekt/faser aktiva. Användaren stannar i tabellen istället för att
 * ryckas ut i en sidopanel.
 */
function WeekPopover({
  week,
  weekIdx,
  anchorX,
  anchorY,
  rows,
  workloadByMember,
  assigneeFilter,
  onClose,
}: {
  week: WeekInfo;
  weekIdx: number;
  anchorX: number;
  anchorY: number;
  rows: ProjectRow[];
  workloadByMember: Map<TeamMember, WeekBooking[]>;
  assigneeFilter: CommentAssignee;
  onClose: () => void;
}) {
  const weekMon = week.monday.toISOString().slice(0, 10);
  const weekSun = week.sunday.toISOString().slice(0, 10);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // KPI:er för veckan
  const stats = useMemo(() => {
    // Per-person bokningar för denna vecka
    const perMember: { member: TeamMember; hours: number; pct: number }[] = [];
    let totalBooked = 0;
    for (const m of teamMembers) {
      const booking = workloadByMember.get(m)?.[weekIdx];
      const hours = booking?.hours ?? 0;
      totalBooked += hours;
      perMember.push({
        member: m,
        hours,
        pct: WEEKLY_CAPACITY > 0 ? hours / WEEKLY_CAPACITY : 0,
      });
    }

    const totalCapacity = WEEKLY_CAPACITY * teamMembers.length;
    const utilizationPct =
      totalCapacity > 0 ? totalBooked / totalCapacity : 0;

    // Antal aktiva faser och projekt denna vecka
    const activeProjects = new Set<string>();
    let phaseCount = 0;
    for (const r of rows) {
      let hasActive = false;
      for (const ph of r.project.phases ?? []) {
        if (!ph.startDate || !ph.endDate) continue;
        if (ph.endDate < weekMon) continue;
        if (ph.startDate > weekSun) continue;
        // Kategori-filter trimmar fas-räkningen; person-filter låter alla
        // faser räknas eftersom de inte bär persondata längre.
        if (
          assigneeFilter &&
          isPhaseCategoryAssignee(assigneeFilter) &&
          ph.type !== assigneeFilter
        ) {
          continue;
        }
        phaseCount++;
        hasActive = true;
      }
      if (hasActive) activeProjects.add(r.project.id);
    }

    return {
      perMember,
      totalBooked,
      totalCapacity,
      utilizationPct,
      projectCount: activeProjects.size,
      phaseCount,
    };
  }, [workloadByMember, weekIdx, rows, weekMon, weekSun, assigneeFilter]);

  // Smart positionering
  const popoverWidth = 320;
  const margin = 12;
  const maxLeft =
    typeof window !== "undefined"
      ? window.innerWidth - popoverWidth - margin
      : 0;
  const left = Math.max(margin, Math.min(anchorX - popoverWidth / 2, maxLeft));
  const popoverHeight = 380;
  const flipUp =
    typeof window !== "undefined" &&
    anchorY + popoverHeight > window.innerHeight - margin;
  const top = flipUp ? anchorY - popoverHeight - 12 : anchorY;

  return (
    <>
      <div className="week-popover-backdrop" onClick={onClose} />
      <div
        className="week-popover"
        style={{ top, left, width: popoverWidth }}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="week-popover-header">
          <div className="week-popover-title">Vecka {week.weekNum}</div>
          <div className="week-popover-range">
            {fmtDay(week.monday)} – {fmtDay(week.sunday)}
          </div>
        </div>

        {/* KPI-block — total beläggning + utilization */}
        <div className="week-kpi-grid">
          <div className="week-kpi-cell">
            <div className="week-kpi-value">{Math.round(stats.totalBooked)}h</div>
            <div className="week-kpi-label">
              av {stats.totalCapacity}h kapacitet
            </div>
          </div>
          <div className="week-kpi-cell">
            <div
              className={`week-kpi-value ${
                stats.utilizationPct > 1
                  ? "over"
                  : stats.utilizationPct >= 0.8
                  ? "high"
                  : ""
              }`}
            >
              {Math.round(stats.utilizationPct * 100)}%
            </div>
            <div className="week-kpi-label">av kapacitet</div>
          </div>
        </div>

        {/* Per-person breakdown */}
        <div className="week-popover-body">
          <div className="week-popover-section-title">Per person</div>
          <ul className="week-team-list">
            {stats.perMember.map((p) => {
              const isOver = p.pct > 1;
              const isFull = p.pct >= 1 && !isOver;
              const isEmpty = p.hours === 0;
              return (
                <li
                  key={p.member}
                  className={`week-team-item ${isEmpty ? "empty" : ""}`}
                >
                  <span className="week-team-name">{p.member}</span>
                  <span className="week-team-bar-wrap">
                    <span
                      className={`week-team-bar ${
                        isOver ? "over" : isFull ? "full" : ""
                      }`}
                      style={{ width: `${Math.min(100, p.pct * 100)}%` }}
                    />
                  </span>
                  <span
                    className={`week-team-hours ${
                      isOver ? "over" : isFull ? "full" : ""
                    }`}
                  >
                    {Math.round(p.hours)}h
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Sekundär stat-rad: faser + projekt */}
          {stats.phaseCount > 0 && (
            <div className="week-popover-meta">
              {stats.projectCount} {stats.projectCount === 1 ? "projekt" : "projekt"}
              <span className="week-popover-meta-sep" aria-hidden>·</span>
              {stats.phaseCount} {stats.phaseCount === 1 ? "fas aktiv" : "faser aktiva"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}


/** En allokering i kontext av sitt projekt — driver TeamAllocRow + AllocPopover. */
interface MemberAlloc {
  customer: string;
  customerSlug: string;
  project: Project;
  allocation: ProjectAllocation;
}

/**
 * Räknar ut belastningen per vecka om allokeringen låg i `range` istället för
 * där den ligger nu. `bookings` innehåller allokeringen på dess sparade plats,
 * så den platsen räknas bort först.
 *
 * Returnerar en Map: veckoindex → nivå ("tight" | "over"). Veckor som ryms
 * utan problem tas inte med.
 */
function loadPreviewForRange(
  bookings: WeekBooking[] | undefined,
  savedRange: RangeResult | null,
  range: RangeResult | null,
  hoursPerWeek: number,
  countsTowardLoad: boolean,
): Map<number, "tight" | "over"> {
  const out = new Map<number, "tight" | "over">();
  if (!range || !countsTowardLoad || hoursPerWeek <= 0) return out;
  for (let i = range.startIdx; i <= range.endIdx; i++) {
    const booked = bookings?.[i]?.hours ?? 0;
    const alreadyHere =
      savedRange && i >= savedRange.startIdx && i <= savedRange.endIdx;
    const base = booked - (alreadyHere ? hoursPerWeek : 0);
    const level = loadLevel(base + hoursPerWeek);
    if (level === "over") out.set(i, "over");
    else if (level === "tight") out.set(i, "tight");
  }
  return out;
}

/** Timmar som får plats i personens minst lediga vecka under perioden. */
function headroomForRange(
  bookings: WeekBooking[] | undefined,
  savedRange: RangeResult | null,
  range: RangeResult | null,
  hoursPerWeek: number,
): number {
  if (!range) return WEEKLY_CAPACITY;
  let min = WEEKLY_CAPACITY;
  for (let i = range.startIdx; i <= range.endIdx; i++) {
    const booked = bookings?.[i]?.hours ?? 0;
    const alreadyHere =
      savedRange && i >= savedRange.startIdx && i <= savedRange.endIdx;
    const base = booked - (alreadyHere ? hoursPerWeek : 0);
    min = Math.min(min, WEEKLY_CAPACITY - base);
  }
  return Math.max(0, Math.round(min * 2) / 2);
}

/**
 * Redigerbar tidsetikett på stapeln. Ett klick räcker för att ändra timmar —
 * tidigare krävdes klick på stapeln, popover, sifferfält och stäng.
 */
function InlineHours({
  hours,
  unit,
  onCommit,
}: {
  hours: number;
  unit: HoursUnit;
  onCommit: (hours: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function begin() {
    setDraft(hoursInputValue(hours, unit));
    setEditing(true);
  }

  function commit() {
    const parsed = parseHoursInput(draft, unit);
    setEditing(false);
    if (parsed !== null && parsed !== hours) onCommit(parsed);
  }

  if (editing) {
    return (
      <input
        className="team-alloc-hours-input"
        value={draft}
        autoFocus
        inputMode="decimal"
        aria-label="Timmar per vecka"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = unit === "%" ? 5 : 1;
            const cur = parseHoursInput(draft, unit) ?? 0;
            const delta =
              (e.key === "ArrowUp" ? 1 : -1) *
              (unit === "%" ? (step / 100) * WEEKLY_CAPACITY : step);
            const next = Math.max(0, Math.round((cur + delta) * 2) / 2);
            setDraft(hoursInputValue(next, unit));
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`team-alloc-bar-label ${hours > 0 ? "" : "is-unset"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        begin();
      }}
      title="Klicka för att ändra tid"
    >
      {hours > 0 ? formatHours(hours, unit) : "Sätt tid"}
    </button>
  );
}

/**
 * En sub-rad i bemanningssektionen: en specifik allokering med dragbar
 * stapel. All drag-logik ligger i useTimelineDrag — samma som fas-raderna.
 */
function TeamAllocRow({
  ma,
  weeks,
  todayIdx,
  isEditing,
  dimmed = false,
  selected,
  hoursUnit,
  bookings,
  onOpenEdit,
  onCloseEdit,
  onSelectBar,
  onPatch,
  onRemove,
  onDuplicate,
  onSetHoursUnit,
}: {
  ma: MemberAlloc;
  weeks: WeekInfo[];
  todayIdx: number;
  isEditing: boolean;
  dimmed?: boolean;
  selected: boolean;
  hoursUnit: HoursUnit;
  bookings: WeekBooking[] | undefined;
  onOpenEdit: () => void;
  onCloseEdit: () => void;
  onSelectBar: () => void;
  onPatch: (patch: Partial<ProjectAllocation>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSetHoursUnit: (unit: HoursUnit) => void;
}) {
  const { preview, dragging, precise, startDrag } = useTimelineDrag({
    startDate: ma.allocation.startDate,
    endDate: ma.allocation.endDate,
    onCommit: (r) => onPatch({ startDate: r.startDate, endDate: r.endDate }),
    onClick: onOpenEdit,
    onDragStart: onSelectBar,
  });

  const savedRange = isoRangeToWeeks(
    weeks,
    ma.allocation.startDate,
    ma.allocation.endDate,
  );
  const draftStart = preview?.startDate ?? ma.allocation.startDate;
  const draftEnd = preview?.endDate ?? ma.allocation.endDate;
  const draftRange = isoRangeToWeeks(weeks, draftStart, draftEnd) ?? savedRange;

  const status = ma.project.status ?? "active";
  const countsTowardLoad = status === "active" || status === "lead";

  // Belastningsvarning medan man drar: vilka veckor skulle bli tajta/överbokade
  // om stapeln landar här? Räknas bara under pågående drag för att inte
  // färga ner hela vyn i vanligt läge.
  const loadPreview = dragging
    ? loadPreviewForRange(
        bookings,
        savedRange,
        draftRange,
        ma.allocation.hoursPerWeek,
        countsTowardLoad,
      )
    : new Map<number, "tight" | "over">();
  const overCount = Array.from(loadPreview.values()).filter(
    (v) => v === "over",
  ).length;

  const dragLabel = preview
    ? `${formatPanelDateRange(preview.startDate, preview.endDate)} · ${weekSpan(
        preview.startDate,
        preview.endDate,
      )} v${precise ? " · dag" : ""}${
        overCount > 0 ? ` · ${overCount} v överbokad` : ""
      }`
    : "";

  return (
    <div
      className={`planering-row planering-row-team-alloc ${dimmed ? "dimmed" : ""}`}
    >
      <div className="planering-row-label team-alloc-label">
        <span className="team-alloc-customer">{ma.allocation.member}</span>
      </div>
      <div className="planering-row-cells team-alloc-cells">
        {todayIdx >= 0 && (
          <div
            className="planering-today-line"
            style={{
              gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
              gridRow: 1,
            }}
          />
        )}
        {Array.from(loadPreview.entries()).map(([idx, level]) => (
          <div
            key={`load-${idx}`}
            className={`alloc-load-cell load-${level}`}
            style={{ gridColumn: `${idx + 1} / ${idx + 2}`, gridRow: 1 }}
            aria-hidden
          />
        ))}
        {draftRange && (
          <div
            className={`team-alloc-bar ${pastWeekFadeClass(draftRange.endIdx, todayIdx)} ${
              selected ? "is-selected" : ""
            } ${dragging ? "is-dragging" : ""}`}
            style={{
              gridColumn: `${draftRange.startIdx + 1} / ${draftRange.endIdx + 2}`,
              gridRow: 1,
            }}
            onPointerDown={(e) => {
              onSelectBar();
              startDrag(e, "move");
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectBar();
              onOpenEdit();
            }}
            title={`${ma.allocation.member} — ${formatHours(
              ma.allocation.hoursPerWeek,
              hoursUnit,
            )}\n${BAR_HINT}`}
          >
            <div
              className="team-alloc-resize team-alloc-resize-left"
              onPointerDown={(e) => {
                onSelectBar();
                startDrag(e, "resize-left");
              }}
              aria-hidden
            />
            {dragging ? (
              <div className="phase-preview-label">{dragLabel}</div>
            ) : (
              <InlineHours
                hours={ma.allocation.hoursPerWeek}
                unit={hoursUnit}
                onCommit={(h) => onPatch({ hoursPerWeek: h })}
              />
            )}
            <div
              className="team-alloc-resize team-alloc-resize-right"
              onPointerDown={(e) => {
                onSelectBar();
                startDrag(e, "resize-right");
              }}
              aria-hidden
            />
          </div>
        )}
        {isEditing && (
          <AllocPopover
            ma={ma}
            bookings={bookings}
            savedRange={savedRange}
            hoursUnit={hoursUnit}
            onSetHoursUnit={onSetHoursUnit}
            onClose={onCloseEdit}
            onPatch={onPatch}
            onRemove={onRemove}
            onDuplicate={onDuplicate}
          />
        )}
      </div>
    </div>
  );
}

// ---- AllocPopover ----------------------------------------------------------

/**
 * Inline-popover som visas vid klick på en allokerings-stapel.
 * Person, tid (med snabbval), datum, duplicera och ta bort.
 */
function AllocPopover({
  ma,
  bookings,
  savedRange,
  hoursUnit,
  onSetHoursUnit,
  onClose,
  onPatch,
  onRemove,
  onDuplicate,
}: {
  ma: MemberAlloc;
  bookings: WeekBooking[] | undefined;
  savedRange: RangeResult | null;
  hoursUnit: HoursUnit;
  onSetHoursUnit: (unit: HoursUnit) => void;
  onClose: () => void;
  onPatch: (patch: Partial<ProjectAllocation>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hours = ma.allocation.hoursPerWeek;
  const headroom = headroomForRange(bookings, savedRange, savedRange, hours);
  const [draft, setDraft] = useState(() => hoursInputValue(hours, hoursUnit));

  // Håll fältet i synk när enheten byts eller timmarna ändras utifrån
  // (snabbval, "fyll ledig tid").
  useEffect(() => {
    setDraft(hoursInputValue(hours, hoursUnit));
  }, [hours, hoursUnit]);

  function commitDraft(raw: string) {
    setDraft(raw);
    const parsed = parseHoursInput(raw, hoursUnit);
    if (parsed !== null && parsed !== hours) onPatch({ hoursPerWeek: parsed });
  }

  return (
    <>
      <div className="alloc-popover-backdrop" onClick={onClose} />
      <div
        className="alloc-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="alloc-popover-header">
          <div className="alloc-popover-titlewrap">
            <span className="alloc-popover-customer">{ma.customer}</span>
            <span className="alloc-popover-project">
              {ma.project.name || "(utan namn)"}
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
            <label className="meta-label" htmlFor="alloc-member">
              Person
            </label>
            <select
              id="alloc-member"
              className="panel-text-input"
              value={ma.allocation.member}
              onChange={(e) =>
                onPatch({ member: e.target.value as TeamMember })
              }
            >
              {teamMembers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="alloc-field">
            <div className="alloc-hours-head">
              <label className="meta-label" htmlFor="alloc-hours">
                {hoursUnit === "%" ? "Andel av veckan" : "Timmar per vecka"}
              </label>
              <div className="alloc-unit-toggle" role="group" aria-label="Enhet">
                <button
                  type="button"
                  className={hoursUnit === "h" ? "on" : ""}
                  onClick={() => onSetHoursUnit("h")}
                >
                  h
                </button>
                <button
                  type="button"
                  className={hoursUnit === "%" ? "on" : ""}
                  onClick={() => onSetHoursUnit("%")}
                >
                  %
                </button>
              </div>
            </div>
            <div className="alloc-hours-wrap">
              <input
                id="alloc-hours"
                type="text"
                inputMode="decimal"
                className="panel-text-input"
                value={draft}
                placeholder="0"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => commitDraft(e.target.value)}
              />
              <span className="alloc-hours-unit">
                {hoursUnit === "%" ? "%" : "h/v"}
              </span>
            </div>
            <div className="alloc-hours-presets">
              {HOURS_PRESETS.map((h) => (
                <button
                  type="button"
                  key={h}
                  className={`alloc-preset ${hours === h ? "on" : ""}`}
                  onClick={() => onPatch({ hoursPerWeek: h })}
                >
                  {formatHoursCompact(h, hoursUnit)}
                </button>
              ))}
              <button
                type="button"
                className="alloc-preset alloc-preset-fill"
                onClick={() => onPatch({ hoursPerWeek: headroom })}
                disabled={headroom <= 0}
                title={
                  headroom > 0
                    ? `Fyller upp till ${formatHoursCompact(headroom, hoursUnit)} — allt som ryms utan att överboka ${ma.allocation.member}`
                    : `${ma.allocation.member} är redan fullbokad under perioden`
                }
              >
                Fyll ledig tid
              </button>
            </div>
          </div>
          <div className="alloc-field-row">
            <div className="alloc-field">
              <label className="meta-label">Startdatum</label>
              <DatePicker
                value={ma.allocation.startDate}
                onChange={(v) => onPatch({ startDate: v })}
                ariaLabel="Allokeringens startdatum"
                size="compact"
              />
            </div>
            <div className="alloc-field">
              <label className="meta-label">Slutdatum</label>
              <DatePicker
                value={ma.allocation.endDate}
                onChange={(v) => onPatch({ endDate: v })}
                ariaLabel="Allokeringens slutdatum"
                size="compact"
              />
            </div>
          </div>
        </div>
        <div className="alloc-popover-footer">
          <button
            type="button"
            className="btn btn-mute danger small"
            onClick={onRemove}
          >
            Ta bort
          </button>
          <div className="alloc-popover-footer-right">
            <button
              type="button"
              className="btn btn-mute small"
              onClick={onDuplicate}
            >
              Duplicera
            </button>
            <button type="button" className="btn small" onClick={onClose}>
              Klar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
