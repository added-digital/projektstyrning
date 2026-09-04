import { supabaseAdmin } from "./supabase";
import {
  allSectionIds,
  CapacityReservation,
  ChecklistCategory,
  ChecklistItem,
  CustomerData,
  defaultChecklist,
  emptyCustomer,
  HourAllocation,
  isoWeekToDateRange,
  newProject,
  PhaseComment,
  phaseOrder,
  PhaseType,
  PricingType,
  pricingTypeOrder,
  Project,
  ProjectAllocation,
  ProjectPhase,
  ProjectTask,
  projectStatusOrder,
  TeamMember,
  teamMembers,
  WeeklyNote,
} from "./sections";

interface LegacyTodo {
  id?: string;
  isoWeek?: string;
  startDate?: string;
  endDate?: string;
  text?: string;
  assignee?: TeamMember | "";
  done?: boolean;
}

function legacyTodoDateRange(t: LegacyTodo): { start: string; end: string } {
  let start = typeof t.startDate === "string" ? t.startDate : "";
  let end = typeof t.endDate === "string" ? t.endDate : "";
  if (!start && typeof t.isoWeek === "string" && t.isoWeek) {
    const r = isoWeekToDateRange(t.isoWeek);
    start = r.start;
    end = r.end;
  }
  if (!end && start) end = start;
  return { start, end };
}

/** Number of overlapping days between two YYYY-MM-DD ranges. */
function overlapDays(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): number {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  if (s > e) return 0;
  const ms = new Date(s + "T00:00:00Z").getTime();
  const me = new Date(e + "T00:00:00Z").getTime();
  return Math.floor((me - ms) / 86400000) + 1;
}

/**
 * Migrate legacy `project.todos` to `phase.comments` by best-fit date overlap.
 * Returns updated phases array. Todos without overlap go to the first phase
 * (or are dropped if no phases exist).
 */
function migrateTodosToPhases(
  phases: ProjectPhase[],
  todos: LegacyTodo[],
): ProjectPhase[] {
  if (todos.length === 0) return phases;
  if (phases.length === 0) return phases;

  const result = phases.map((p) => ({
    ...p,
    comments: Array.isArray(p.comments) ? [...p.comments] : [],
  }));

  for (let i = 0; i < todos.length; i++) {
    const t = todos[i];
    const range = legacyTodoDateRange(t);
    let bestIdx = 0;
    let bestOverlap = -1;
    for (let j = 0; j < result.length; j++) {
      const p = result[j];
      const ov = overlapDays(range.start, range.end, p.startDate, p.endDate);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestIdx = j;
      }
    }
    // Convert legacy todo's single assignee field into the new comment shape
    const legacyAssignee = typeof t.assignee === "string" ? t.assignee : "";
    let category: PhaseType | "" = "";
    let assignees: TeamMember[] = [];
    if (PHASE_TYPES.has(legacyAssignee)) {
      category = legacyAssignee as PhaseType;
    } else if (TEAM_MEMBERS_SET.has(legacyAssignee)) {
      assignees = [legacyAssignee as TeamMember];
    }
    const comment: PhaseComment = {
      id:
        t.id ?? `cm-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      text: typeof t.text === "string" ? t.text : "",
      category,
      assignees,
      done: t.done === true,
    };
    result[bestIdx].comments!.push(comment);
  }
  return result;
}

const PHASE_TYPES = new Set<string>(phaseOrder);
const TEAM_MEMBERS_SET = new Set<string>(teamMembers);

function normalizeComment(
  raw: Partial<PhaseComment> & { assignee?: string },
  idx: number,
): PhaseComment {
  // Backward-compat: convert legacy single `assignee` (could be PhaseType
  // or TeamMember) into the new `category` + `assignees` split.
  let category: PhaseType | "" = "";
  let assignees: TeamMember[] = [];

  if (Array.isArray(raw.assignees)) {
    assignees = (raw.assignees as string[]).filter((a): a is TeamMember =>
      TEAM_MEMBERS_SET.has(a),
    );
  }
  if (typeof raw.category === "string" && PHASE_TYPES.has(raw.category)) {
    category = raw.category as PhaseType;
  }

  if (!category && !assignees.length && typeof raw.assignee === "string") {
    if (PHASE_TYPES.has(raw.assignee)) {
      category = raw.assignee as PhaseType;
    } else if (TEAM_MEMBERS_SET.has(raw.assignee)) {
      assignees = [raw.assignee as TeamMember];
    }
  }

  return {
    id:
      raw.id ??
      `cm-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    text: typeof raw.text === "string" ? raw.text : "",
    category,
    assignees,
    done: raw.done === true,
  };
}

/** Default-datum för allokeringar som migreras utan egna: idag → år-slut. */
function defaultAllocationDates(
  projectStart: string | undefined,
  projectEnd: string | undefined,
): { startDate: string; endDate: string } {
  if (projectStart && projectEnd) {
    return { startDate: projectStart, endDate: projectEnd };
  }
  const today = new Date();
  const startStr = today.toISOString().slice(0, 10);
  // Sista dagen i innevarande år
  const endOfYear = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  const endStr = endOfYear.toISOString().slice(0, 10);
  return {
    startDate: projectStart || startStr,
    endDate: projectEnd || endStr,
  };
}

/**
 * Normaliserar uppgifter. Medvetet förlåtande eftersom de skrivs för hand
 * (av Codex) direkt i JSON-filerna:
 *  - saknat `id` eller `createdAt` fylls i
 *  - okänd `assignee` blir "" (uppgiften hamnar under "Ej tilldelat")
 *    istället för att tyst försvinna
 * Bara poster helt utan text kastas.
 */
function normalizeTasks(raw: unknown): ProjectTask[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t, idx): ProjectTask | null => {
      if (!t || typeof t !== "object") return null;
      const v = t as Partial<ProjectTask>;
      const text = typeof v.text === "string" ? v.text.trim() : "";
      if (!text) return null;
      const assignee =
        typeof v.assignee === "string" && TEAM_MEMBERS_SET.has(v.assignee)
          ? (v.assignee as TeamMember)
          : "";
      const dueDate =
        typeof v.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)
          ? v.dueDate
          : undefined;
      return {
        id:
          typeof v.id === "string" && v.id
            ? v.id
            : `tk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        assignee,
        done: v.done === true,
        createdAt:
          typeof v.createdAt === "string" && v.createdAt
            ? v.createdAt
            : new Date().toISOString(),
        ...(dueDate ? { dueDate } : {}),
      };
    })
    .filter((t): t is ProjectTask => t !== null);
}

function normalizeAllocations(
  raw: unknown,
  projectStart: string | undefined,
  projectEnd: string | undefined,
): ProjectAllocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a, idx): ProjectAllocation | null => {
      if (!a || typeof a !== "object") return null;
      const v = a as Partial<ProjectAllocation>;
      const member = typeof v.member === "string" ? v.member : "";
      if (!TEAM_MEMBERS_SET.has(member)) return null;
      const hours = Number(v.hoursPerWeek);
      if (!Number.isFinite(hours) || hours < 0) return null;
      const defaults = defaultAllocationDates(projectStart, projectEnd);
      return {
        id:
          v.id ??
          `al-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        member: member as TeamMember,
        hoursPerWeek: hours,
        startDate:
          typeof v.startDate === "string" && v.startDate
            ? v.startDate
            : defaults.startDate,
        endDate:
          typeof v.endDate === "string" && v.endDate
            ? v.endDate
            : defaults.endDate,
      };
    })
    .filter((a): a is ProjectAllocation => a !== null);
}

const PRICING_TYPES = new Set<string>(pricingTypeOrder);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCapacityReservations(raw: unknown): CapacityReservation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx): CapacityReservation | null => {
      if (!item || typeof item !== "object") return null;
      const v = item as Partial<CapacityReservation>;
      const minHours = Math.max(0, Number(v.minHours));
      const maxHours = Math.max(minHours, Number(v.maxHours));
      const probability = Math.min(1, Math.max(0, Number(v.probability)));
      if (![minHours, maxHours, probability].every(Number.isFinite)) return null;
      if (!v.startDate || !ISO_DATE_RE.test(v.startDate)) return null;
      const endDate =
        v.endDate && ISO_DATE_RE.test(v.endDate) && v.endDate >= v.startDate
          ? v.endDate
          : v.startDate;
      return {
        id: v.id || `cr-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        member:
          typeof v.member === "string" && TEAM_MEMBERS_SET.has(v.member)
            ? (v.member as TeamMember)
            : teamMembers[0],
        minHours,
        maxHours,
        probability,
        startDate: v.startDate,
        endDate,
        comment: typeof v.comment === "string" ? v.comment : "",
      };
    })
    .filter((v): v is CapacityReservation => v !== null);
}

function normalizePricingType(raw: unknown): PricingType | undefined {
  return typeof raw === "string" && PRICING_TYPES.has(raw)
    ? (raw as PricingType)
    : undefined;
}

/**
 * Timallokeringar (beläggningsvyn). Förlåtande på samma sätt som
 * uppgifterna: saknat id/createdAt fylls i. Poster utan giltig person,
 * giltiga datum eller ett tal i `hours` kastas — de går inte att rita.
 */
function normalizeHourAllocations(raw: unknown): HourAllocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a, idx): HourAllocation | null => {
      if (!a || typeof a !== "object") return null;
      const v = a as Partial<HourAllocation>;
      const member = typeof v.member === "string" ? v.member : "";
      if (!TEAM_MEMBERS_SET.has(member)) return null;
      const hours = Number(v.hours);
      const isRange = v.estimateMode === "range";
      const lowHours = Number(v.lowHours);
      const likelyHours = Number(v.likelyHours);
      const highHours = Number(v.highHours);
      const rangeOk =
        [lowHours, likelyHours, highHours].every(Number.isFinite) &&
        lowHours >= 0 && lowHours <= likelyHours && likelyHours <= highHours;
      if ((!Number.isFinite(hours) || hours < 0) && !(isRange && rangeOk)) return null;
      const startDate =
        typeof v.startDate === "string" && ISO_DATE_RE.test(v.startDate)
          ? v.startDate
          : "";
      let endDate =
        typeof v.endDate === "string" && ISO_DATE_RE.test(v.endDate)
          ? v.endDate
          : "";
      if (!startDate) return null;
      if (!endDate || endDate < startDate) endDate = startDate;
      return {
        id:
          typeof v.id === "string" && v.id
            ? v.id
            : `ha-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        member: member as TeamMember,
        hours: isRange && rangeOk ? (lowHours + 4 * likelyHours + highHours) / 6 : hours,
        ...(isRange && rangeOk
          ? { estimateMode: "range" as const, lowHours, likelyHours, highHours }
          : { estimateMode: "fixed" as const }),
        // Saknat läge = totalt: poster skapade innan `mode` fanns var alltid
        // totala timmar, och det är det säkra valet för handskriven JSON.
        mode: v.repeat ? "per_day" : v.mode === "per_day" ? "per_day" : "total",
        ...(v.repeat === "week" || v.repeat === "month" ? { repeat: v.repeat } : {}),
        startDate,
        endDate,
        comment: typeof v.comment === "string" ? v.comment : "",
        ...(typeof v.createdBy === "string" && v.createdBy
          ? { createdBy: v.createdBy }
          : {}),
        createdAt:
          typeof v.createdAt === "string" && v.createdAt
            ? v.createdAt
            : new Date().toISOString(),
      };
    })
    .filter((a): a is HourAllocation => a !== null);
}

function normalizeWeeklyNotes(raw: unknown): WeeklyNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n, i): WeeklyNote | null => {
      if (!n || typeof n !== "object") return null;
      const v = n as Partial<WeeklyNote>;
      const yearWeek = typeof v.yearWeek === "string" ? v.yearWeek : "";
      if (!yearWeek) return null;
      return {
        id:
          v.id ??
          `wn-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        yearWeek,
        text: typeof v.text === "string" ? v.text : "",
        updatedAt:
          typeof v.updatedAt === "string"
            ? v.updatedAt
            : new Date().toISOString(),
      };
    })
    .filter((n): n is WeeklyNote => n !== null);
}

function normalizePhases(
  rawPhases: unknown,
  legacyTodos: LegacyTodo[],
): ProjectPhase[] {
  const phases: ProjectPhase[] = Array.isArray(rawPhases)
    ? (rawPhases as Partial<ProjectPhase>[]).map((p) => {
        const comments = Array.isArray(p.comments)
          ? (p.comments as (Partial<PhaseComment> & { assignee?: string })[]).map(
              (c, i) => normalizeComment(c, i),
            )
          : [];
        // Migrera comments → notes. Om notes redan satt, behåll det.
        // Annars: bygg notes från comments (en uppgift per rad, ✓-prefix
        // för markerade som klara). När notes finns nollställer vi
        // comments-arrayen eftersom UI:t inte längre använder den.
        const existingNotes = typeof p.notes === "string" ? p.notes : "";
        let notes = existingNotes;
        let preservedComments: PhaseComment[] = comments;
        if (!existingNotes && comments.length > 0) {
          notes = comments
            .map((c) => `${c.done ? "✓ " : ""}${c.text}`.trim())
            .filter((line) => line.length > 0)
            .join("\n");
          preservedComments = [];
        }
        return {
          id:
            p.id ??
            `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: (p.type as ProjectPhase["type"]) ?? "Strategi",
          label: typeof p.label === "string" ? p.label : "",
          startDate: typeof p.startDate === "string" ? p.startDate : "",
          endDate: typeof p.endDate === "string" ? p.endDate : "",
          notes,
          comments: preservedComments,
        };
      })
    : [];
  if (legacyTodos.length > 0) {
    return migrateTodosToPhases(phases, legacyTodos);
  }
  return phases;
}

/** Map old (pre-categorized) checklist item IDs to their new category. */
const LEGACY_CHECKLIST_CATEGORY: Record<string, ChecklistCategory> = {
  domain: "Utveckling",
  ssl: "Utveckling",
  forms: "Utveckling",
  perf: "Utveckling",
  browsers: "Utveckling",
  backup: "Utveckling",
  analytics: "SEO",
  seo: "SEO",
  redirects: "SEO",
  og: "SEO",
  gdpr: "Innehåll",
  "404": "Innehåll",
};

function ensureChecklistCategory(item: Partial<ChecklistItem>): ChecklistItem {
  const id = item.id ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const category =
    item.category ?? LEGACY_CHECKLIST_CATEGORY[id] ?? "Utveckling";
  return {
    id,
    label: item.label ?? "",
    done: item.done ?? false,
    category,
  };
}

/**
 * Raden i customers-tabellen. `doc` håller hela kunddokumentet
 * ({ projects, activeProjectId }) — normalisering och legacy-migrering
 * körs vid läsning, precis som när dokumenten låg som JSON-filer.
 */
interface CustomerRow {
  slug: string;
  client: string;
  doc: { projects?: Partial<Project>[]; activeProjectId?: string | null };
  updated_at: string;
}

/** Convert a free-text customer name into a safe, deterministic slug. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/å/g, "a")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/é/g, "e")
      .replace(/è/g, "e")
      .replace(/ü/g, "u")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip remaining diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "kund"
  );
}

/** Reject anything that doesn't look like a slug we generated ourselves. */
function assertSafeSlug(slug: string): void {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
}

export interface CustomerSummary {
  slug: string;
  client: string;
  projectCount: number;
  updatedAt: string;
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  const { data, error } = await supabaseAdmin()
    .from("customers")
    .select("slug, client, doc, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listCustomers: ${error.message}`);

  return (data as CustomerRow[]).map((row) => ({
    slug: row.slug,
    client: row.client || row.slug,
    projectCount: Array.isArray(row.doc?.projects) ? row.doc.projects.length : 0,
    updatedAt: row.updated_at,
  }));
}

export interface DataVersion {
  version: string;
  fileCount: number;
  latestMtimeMs: number;
}

/**
 * Lightweight fingerprint for the customer data. Used by the client to
 * notice writes made outside the browser (Codex, andra flikar, andra
 * personer). Samma form som filversionen: `antal:senaste-ändring`.
 */
export async function getDataVersion(): Promise<DataVersion> {
  const db = supabaseAdmin();
  const [countRes, latestRes] = await Promise.all([
    db.from("customers").select("slug", { count: "exact", head: true }),
    db
      .from("customers")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (countRes.error) throw new Error(`getDataVersion: ${countRes.error.message}`);
  if (latestRes.error) throw new Error(`getDataVersion: ${latestRes.error.message}`);

  const fileCount = countRes.count ?? 0;
  const latestMtimeMs = latestRes.data
    ? new Date((latestRes.data as { updated_at: string }).updated_at).getTime()
    : 0;

  return {
    version: `${fileCount}:${latestMtimeMs}`,
    fileCount,
    latestMtimeMs,
  };
}

/**
 * Normalize a single project — fills missing fields with safe defaults so
 * older saved files can be loaded without crashing.
 */
function normalizeProject(p: Partial<Project> & { todos?: unknown }, idx: number): Project {
  const validSectionIds = new Set(allSectionIds);
  const enabled =
    Array.isArray(p.enabledSections) && p.enabledSections.length > 0
      ? p.enabledSections
          .filter((id): id is number => typeof id === "number")
          // Strip any section IDs that no longer exist (legacy To-do (9),
          // Mötesanteckningar (5), Designkoncept (7), Assets (8)).
          .filter((id) => validSectionIds.has(id))
      : [...allSectionIds];
  const legacyTodos: LegacyTodo[] = Array.isArray(p.todos)
    ? (p.todos as LegacyTodo[])
    : [];
  // Forward-kompatibel status-normalisering: bevara ALLA icke-tomma string-
  // värden istället för att tvinga okända till "active". Anledningen är att
  // tidigare buggar (validStatuses-set som inte var synkad med ProjectStatus
  // i lib/sections.ts) tyst tappade lead-status vid reload. Med den här
  // strategin bevaras värdet på disk även om koden tillfälligt inte känner
  // till statusen — och vi loggar en synlig warning så framtida bugg-spår
  // blir uppenbara istället för tysta data-förluster.
  const validStatuses = new Set<string>(projectStatusOrder);
  let status: Project["status"];
  if (typeof p.status === "string" && p.status.length > 0) {
    if (!validStatuses.has(p.status)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[storage] Unknown project.status="${p.status}" preserved as-is. ` +
          `Add it to ProjectStatus in lib/sections.ts if it's intentional.`,
      );
    }
    status = p.status as Project["status"];
  } else {
    status = "active";
  }
  return {
    id: p.id ?? `p-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    name: p.name ?? "",
    template: p.template ?? "custom",
    status,
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    enabledSections: enabled,
    activeSection: p.activeSection ?? enabled[0] ?? 1,
    answers: p.answers ?? {},
    checklist:
      p.checklist && p.checklist.length > 0
        ? p.checklist.map(ensureChecklistCategory)
        : defaultChecklist.map((c) => ({ ...c })),
    phases: normalizePhases(p.phases, legacyTodos),
    weeklyNotes: normalizeWeeklyNotes(p.weeklyNotes),
    allocations: normalizeAllocations(
      p.allocations,
      p.startDate,
      p.endDate,
    ),
    tasks: normalizeTasks(p.tasks),
    // Beläggningsvyn. De äldre fälten ovan (phases/allocations/tasks)
    // behålls medvetet så att inget i databasen tappas vid sparning.
    capacityReservations: normalizeCapacityReservations(p.capacityReservations),
    pricingType: normalizePricingType(p.pricingType),
    hourAllocations: normalizeHourAllocations(p.hourAllocations),
    updatedAt: p.updatedAt,
  };
}

/**
 * Migrate an old-style customer document (with answers/notes/checklist at the
 * top level and no `projects` array) into the new shape: wrap as a single
 * default project named "Projekt 1" with all sections enabled.
 */
interface LegacyShape {
  client?: string;
  date?: string;
  deliveryDate?: string;
  activeSection?: number;
  answers?: Project["answers"];
  /** Removed: meeting notes are no longer part of a project. Kept on the
   *  legacy shape so old files can still be detected as non-empty. */
  notes?: unknown;
  checklist?: Project["checklist"];
  updatedAt?: string;
  projects?: Partial<Project>[];
  activeProjectId?: string | null;
}

function migrateIfNeeded(raw: LegacyShape): CustomerData {
  const hasProjects = Array.isArray(raw.projects);
  if (hasProjects) {
    const projects = raw.projects!.map((p, idx) => normalizeProject(p, idx));
    return {
      client: raw.client ?? "",
      projects,
      activeProjectId:
        raw.activeProjectId &&
        projects.some((p) => p.id === raw.activeProjectId)
          ? raw.activeProjectId
          : projects[0]?.id ?? null,
      updatedAt: raw.updatedAt,
    };
  }

  // Legacy single-project shape. Wrap whatever data is there.
  const hasAnyContent =
    (raw.answers && Object.keys(raw.answers).length > 0) ||
    (Array.isArray(raw.notes) && raw.notes.length > 0) ||
    (Array.isArray(raw.checklist) && raw.checklist.some((c) => c.done));

  if (!hasAnyContent && !raw.client) {
    return emptyCustomer();
  }

  const wrapped = newProject("Projekt 1", "webb");
  wrapped.startDate = raw.date ?? "";
  wrapped.endDate = raw.deliveryDate ?? "";
  wrapped.activeSection = raw.activeSection ?? 1;
  wrapped.answers = raw.answers ?? {};
  wrapped.checklist =
    raw.checklist && raw.checklist.length > 0
      ? raw.checklist.map(ensureChecklistCategory)
      : defaultChecklist.map((c) => ({ ...c }));
  wrapped.updatedAt = raw.updatedAt;

  return {
    client: raw.client ?? "",
    projects: [wrapped],
    activeProjectId: wrapped.id,
    updatedAt: raw.updatedAt,
  };
}

export async function readCustomer(slug: string): Promise<CustomerData> {
  assertSafeSlug(slug);
  const { data, error } = await supabaseAdmin()
    .from("customers")
    .select("slug, client, doc, updated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`readCustomer(${slug}): ${error.message}`);
  if (!data) return emptyCustomer();

  const row = data as CustomerRow;
  // Samma migrerings-/normaliseringsväg som när dokumentet låg i en fil.
  return migrateIfNeeded({
    client: row.client,
    projects: row.doc?.projects,
    activeProjectId: row.doc?.activeProjectId,
    updatedAt: row.updated_at,
  } as LegacyShape);
}

export async function writeCustomer(slug: string, data: CustomerData): Promise<CustomerData> {
  assertSafeSlug(slug);
  const projects = (data.projects ?? []).map((p, idx) => normalizeProject(p, idx));
  const activeProjectId =
    data.activeProjectId && projects.some((p) => p.id === data.activeProjectId)
      ? data.activeProjectId
      : projects[0]?.id ?? null;

  // Upsert på slug — updated_at sätts av databasen (default vid insert,
  // trigger vid update), aldrig härifrån.
  const { data: saved, error } = await supabaseAdmin()
    .from("customers")
    .upsert(
      { slug, client: data.client ?? "", doc: { projects, activeProjectId } },
      { onConflict: "slug" },
    )
    .select("updated_at")
    .single();
  if (error) throw new Error(`writeCustomer(${slug}): ${error.message}`);

  return {
    client: data.client ?? "",
    projects,
    activeProjectId,
    updatedAt: (saved as { updated_at: string }).updated_at,
  };
}

export async function deleteCustomer(slug: string): Promise<boolean> {
  assertSafeSlug(slug);
  const { data, error } = await supabaseAdmin()
    .from("customers")
    .delete()
    .eq("slug", slug)
    .select("slug");
  if (error) throw new Error(`deleteCustomer(${slug}): ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function customerExists(slug: string): Promise<boolean> {
  assertSafeSlug(slug);
  const { count, error } = await supabaseAdmin()
    .from("customers")
    .select("slug", { count: "exact", head: true })
    .eq("slug", slug);
  if (error) throw new Error(`customerExists(${slug}): ${error.message}`);
  return (count ?? 0) > 0;
}
