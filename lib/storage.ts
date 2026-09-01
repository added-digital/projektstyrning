import { promises as fs } from "node:fs";
import path from "node:path";
import {
  allSectionIds,
  ChecklistCategory,
  ChecklistItem,
  CustomerData,
  defaultChecklist,
  emptyCustomer,
  isoWeekToDateRange,
  newProject,
  PhaseComment,
  phaseOrder,
  PhaseType,
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

const DATA_DIR = path.join(process.cwd(), "data");

/** Convert a free-text customer name into a safe, deterministic filename slug. */
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

/** Reject anything that could escape the data directory. */
function assertSafeSlug(slug: string): void {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.includes("..") || slug.startsWith(".")) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function fileFor(slug: string): string {
  return path.join(DATA_DIR, `${slug}.json`);
}

export interface CustomerSummary {
  slug: string;
  client: string;
  projectCount: number;
  updatedAt: string;
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR);
  const summaries: CustomerSummary[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const slug = entry.replace(/\.json$/, "");
    try {
      const data = await readCustomer(slug);
      const stat = await fs.stat(fileFor(slug));
      summaries.push({
        slug,
        client: data.client || slug,
        projectCount: data.projects.length,
        updatedAt: data.updatedAt || stat.mtime.toISOString(),
      });
    } catch {
      // skip unreadable files
    }
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export interface DataVersion {
  version: string;
  fileCount: number;
  latestMtimeMs: number;
}

/**
 * Lightweight fingerprint for the JSON-backed customer data.
 * Used by the client to notice file edits made outside the browser.
 */
export async function getDataVersion(): Promise<DataVersion> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR);
  let fileCount = 0;
  let latestMtimeMs = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const stat = await fs.stat(path.join(DATA_DIR, entry));
      fileCount++;
      latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs);
    } catch {
      // Ignore files that disappear while scanning.
    }
  }

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
  await ensureDataDir();
  try {
    const raw = await fs.readFile(fileFor(slug), "utf8");
    const parsed = JSON.parse(raw) as LegacyShape;
    return migrateIfNeeded(parsed);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyCustomer();
    }
    throw err;
  }
}

export async function writeCustomer(slug: string, data: CustomerData): Promise<CustomerData> {
  assertSafeSlug(slug);
  await ensureDataDir();
  const projects = (data.projects ?? []).map((p, idx) => normalizeProject(p, idx));
  const payload: CustomerData = {
    client: data.client ?? "",
    projects,
    activeProjectId:
      data.activeProjectId && projects.some((p) => p.id === data.activeProjectId)
        ? data.activeProjectId
        : projects[0]?.id ?? null,
    updatedAt: new Date().toISOString(),
  };
  // Atomic write via tmp file rename — avoids partial writes if the process dies mid-save.
  const tmp = fileFor(`${slug}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const final = fileFor(slug);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmp, final);
  return payload;
}

export async function deleteCustomer(slug: string): Promise<boolean> {
  assertSafeSlug(slug);
  try {
    await fs.unlink(fileFor(slug));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function customerExists(slug: string): Promise<boolean> {
  assertSafeSlug(slug);
  try {
    await fs.access(fileFor(slug));
    return true;
  } catch {
    return false;
  }
}
