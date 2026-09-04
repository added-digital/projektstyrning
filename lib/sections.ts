export type QuestionType = "text" | "chips";
export type SectionKind = "questions" | "checklist";

// ---- Team --------------------------------------------------------------

export const teamMembers = [
  "Per Albin Wilhelmsson",
  "David Saupe",
  "Oliver Lundkvist",
  "Albin Herbst",
  "Gustav Lindwall",
] as const;

export type TeamMember = (typeof teamMembers)[number];

export interface Question {
  q: string;
  type: QuestionType;
  why: string;
  placeholder: string;
}

export interface Section {
  id: number;
  title: string;
  subtitle: string;
  kind: SectionKind;
  questions: Question[];
}

export const sections: Section[] = [
  {
    id: 6,
    title: "Checklista",
    subtitle: "Det som måste vara klart innan sajten går live. Bocka av i takt med att ni blir klara.",
    kind: "checklist",
    questions: [],
  },
];

export const totalQuestions = sections
  .filter((s) => s.kind === "questions")
  .reduce((acc, s) => acc + s.questions.length, 0);

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export type ChecklistCategory = "SEO" | "Design" | "Innehåll" | "Utveckling";

export const checklistCategoryOrder: ChecklistCategory[] = [
  "SEO",
  "Design",
  "Innehåll",
  "Utveckling",
];

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  category: ChecklistCategory;
}

export const defaultChecklist: ChecklistItem[] = [
  // ----- SEO -----
  { id: "seo-meta",      category: "SEO", label: "Meta-titel och meta-beskrivning på alla sidor",   done: false },
  { id: "seo-og",        category: "SEO", label: "Open Graph-bilder för delning",                    done: false },
  { id: "seo-sitemap",   category: "SEO", label: "sitemap.xml + robots.txt på plats",                done: false },
  { id: "seo-redirects", category: "SEO", label: "301-redirects från gamla URL:er",                  done: false },
  { id: "seo-schema",    category: "SEO", label: "Strukturerad data (schema.org) där relevant",      done: false },
  { id: "seo-gsc",       category: "SEO", label: "Google Search Console verifierad och kopplad",     done: false },
  { id: "seo-analytics", category: "SEO", label: "Analytics installerat — sidvisningar och events",  done: false },

  // ----- Design -----
  { id: "des-figma",      category: "Design", label: "Designkomponenter slutgranskade i Figma",                       done: false },
  { id: "des-responsive", category: "Design", label: "Mobil + desktop genomgångna i alla vyer",                       done: false },
  { id: "des-a11y",       category: "Design", label: "Tillgänglighet: kontrast, fokusring, tangentbordsnavigation",   done: false },
  { id: "des-states",     category: "Design", label: "Loading-, tom- och felstatusar designade",                      done: false },
  { id: "des-404",        category: "Design", label: "404-sida designad",                                              done: false },
  { id: "des-system",     category: "Design", label: "Konsekvent typografi och spacing i komponentbiblioteket",       done: false },

  // ----- Innehåll -----
  { id: "con-copy",     category: "Innehåll", label: "Alla texter korrekturlästa och godkända",          done: false },
  { id: "con-tone",     category: "Innehåll", label: "Tonalitet konsekvent över sidor och komponenter", done: false },
  { id: "con-images",   category: "Innehåll", label: "Bilder optimerade (storlek + WebP/AVIF)",          done: false },
  { id: "con-alt",      category: "Innehåll", label: "Alt-text på alla bilder",                          done: false },
  { id: "con-favicon",  category: "Innehåll", label: "Favicon i alla format",                            done: false },
  { id: "con-legal",    category: "Innehåll", label: "Cookies, integritetspolicy och övriga juridiska sidor", done: false },
  { id: "con-404copy",  category: "Innehåll", label: "Copy för 404-sida och felmeddelanden klar",        done: false },

  // ----- Utveckling -----
  { id: "dev-domain",   category: "Utveckling", label: "Domän + DNS konfigurerat",                       done: false },
  { id: "dev-ssl",      category: "Utveckling", label: "SSL aktiverat och förnyas automatiskt",          done: false },
  { id: "dev-comp",     category: "Utveckling", label: "Alla komponenter renderar korrekt i alla mallar", done: false },
  { id: "dev-forms",    category: "Utveckling", label: "Formulär kopplade till rätt mottagare och testade", done: false },
  { id: "dev-perf",     category: "Utveckling", label: "Lighthouse / Core Web Vitals godkända",          done: false },
  { id: "dev-browsers", category: "Utveckling", label: "Testat i Chrome, Safari, Firefox + mobil",       done: false },
  { id: "dev-stage",    category: "Utveckling", label: "Stage- och prodmiljöer tydligt separerade",       done: false },
  { id: "dev-backup",   category: "Utveckling", label: "Backup och versionshantering på plats",          done: false },
];

/**
 * Bredare lista av föreslagna checklistpunkter per kategori.
 * Visas som autocomplete-förslag när man lägger till en ny punkt.
 * Inkluderar default-punkterna också så de kan läggas tillbaka om man rensat dem.
 */
export const checklistSuggestions: Record<ChecklistCategory, string[]> = {
  SEO: [
    "Meta-titel och meta-beskrivning på alla sidor",
    "Open Graph-bilder för delning",
    "Twitter Card-taggar",
    "sitemap.xml + robots.txt på plats",
    "301-redirects från gamla URL:er",
    "www / non-www redirect konfigurerad",
    "Strukturerad data (schema.org) där relevant",
    "Canonical-taggar på alla sidor",
    "hreflang-taggar (om flera språk)",
    "Google Search Console verifierad och kopplad",
    "Bing Webmaster Tools verifierad",
    "Analytics installerat — sidvisningar och events",
    "Konverteringshändelser konfigurerade i Analytics",
    "Goal tracking konfigurerat",
    "Internlänkar mellan relaterade sidor",
    "Brutna länkar genomgångna",
    "Mobile-friendly test godkänd",
    "URL-struktur granskad och SEO-vänlig",
    "robots.txt blockerar känsliga sidor",
  ],
  Design: [
    "Designkomponenter slutgranskade i Figma",
    "Mobil + desktop genomgångna i alla vyer",
    "Tablet-layout granskad",
    "Tillgänglighet: kontrast, fokusring, tangentbordsnavigation",
    "Hover- och focus-states på alla interaktiva element",
    "Loading-, tom- och felstatusar designade",
    "Form validation-states designade",
    "404-sida designad",
    "500-sida designad",
    "Konsekvent typografi och spacing i komponentbiblioteket",
    "Iconset komplett och konsekvent",
    "Animations och transitions polerade",
    "Print-stylesheet (om relevant)",
    "Designsystem dokumenterat",
    "Responsiv typografi (clamp/rem)",
    "Dark mode-stöd (om tillämpligt)",
    "Designtokens exporterade till kod",
    "Komponentvarianter genomgångna i alla states",
  ],
  "Innehåll": [
    "Alla texter korrekturlästa och godkända",
    "Tonalitet konsekvent över sidor och komponenter",
    "Bilder optimerade (storlek + WebP/AVIF)",
    "Alt-text på alla bilder",
    "Favicon i alla format",
    "Cookies, integritetspolicy och övriga juridiska sidor",
    "Copy för 404-sida och felmeddelanden klar",
    "About/Om oss-sidan komplett",
    "Kontaktuppgifter korrekta",
    "Microcopy (knappar, hints, tooltips) genomgången",
    "Hjälptexter på formulär",
    "Bildbyline / fotokredit där det krävs",
    "Video-thumbnails och beskrivningar",
    "Reviews / testimonials uppdaterade",
    "Källhänvisningar och fotnoter",
    "Sociala medier-länkar uppdaterade",
    "E-postsignaturer / footer copy",
    "Leveranspolicy och returvillkor (om e-handel)",
  ],
  Utveckling: [
    "Domän + DNS konfigurerat",
    "SSL aktiverat och förnyas automatiskt",
    "Alla komponenter renderar korrekt i alla mallar",
    "Komponentbibliotek dokumenterat",
    "Storybook eller motsvarande uppdaterad",
    "Formulär kopplade till rätt mottagare och testade",
    "Lighthouse / Core Web Vitals godkända",
    "Testat i Chrome, Safari, Firefox + mobil",
    "Stage- och prodmiljöer tydligt separerade",
    "Backup och versionshantering på plats",
    "CI/CD-pipeline grön",
    "Environment variables säkrade",
    "Feature flags konfigurerade (om relevant)",
    "Error logging (Sentry eller motsvarande)",
    "Monitoring / uptime checks aktivt",
    "CDN konfigurerad",
    "Caching-strategi konfigurerad",
    "Säkerhetsheaders (CSP, HSTS, X-Frame-Options)",
    "Cookie-management implementerat",
    "Rate limiting på publika API:er",
    "Bundle size under tröskel",
    "Accessibility audit (axe / Lighthouse)",
    "Webhooks testade",
  ],
};

// ---- Phases ------------------------------------------------------------

export type PhaseType =
  | "Strategi"
  | "Content"
  | "Design"
  | "Utveckling"
  | "Projektstyrning";

export const phaseOrder: readonly PhaseType[] = [
  "Strategi",
  "Content",
  "Design",
  "Utveckling",
  "Projektstyrning",
] as const;

/**
 * Filter value: matches a comment if its category equals the filter, or
 * any of its assignees equals the filter. May be team member, phase type,
 * or empty string (= no filter).
 */
export type CommentAssignee = TeamMember | PhaseType | "";

export interface PhaseComment {
  id: string;
  text: string;
  /** Optional category tag (independent of the parent phase's type). */
  category?: PhaseType | "";
  /** Zero or more assigned team members. */
  assignees: TeamMember[];
  done: boolean;
}

/** True if the given filter string refers to a phase category. */
export function isPhaseCategoryAssignee(
  value: string,
): value is PhaseType {
  return (phaseOrder as readonly string[]).includes(value);
}

export const newComment = (): PhaseComment => ({
  id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  text: "",
  category: "",
  assignees: [],
  done: false,
});

export interface ProjectPhase {
  id: string;
  type: PhaseType;
  /** Valfritt sprint-namn. Visas istället för typnamnet när satt. */
  label?: string;
  /** ISO YYYY-MM-DD. */
  startDate: string;
  /** ISO YYYY-MM-DD. */
  endDate: string;
  /** Fritextnotering om fasen (Notion-likt fält). Ersätter det gamla
   *  "uppgifter/comments"-flödet. */
  notes?: string;
  /** Legacy: tidigare uppgifts-system. Behålls för bakåtkompatibilitet
   *  men används inte längre i UI:t. Migreras till `notes` i storage. */
  comments?: PhaseComment[];
}

/** Returnerar fasens visningsnamn — label om satt, annars typ. */
export function phaseDisplayName(p: ProjectPhase): string {
  const l = p.label?.trim();
  return l ? l : p.type;
}

export const newPhase = (type: PhaseType = "Strategi"): ProjectPhase => ({
  id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type,
  startDate: "",
  endDate: "",
});

// ---- Weekly notes ------------------------------------------------------

/**
 * Snabba veckonoteringar per projekt — t.ex. det man pratar om på
 * måndagsmötet. Knutna till en specifik ISO-vecka, inte en fas.
 */
export interface WeeklyNote {
  id: string;
  /** ISO week string, t.ex. "2026-W20". */
  yearWeek: string;
  text: string;
  updatedAt: string;
}

export const newWeeklyNote = (yearWeek: string, text = ""): WeeklyNote => ({
  id: `wn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  yearWeek,
  text,
  updatedAt: new Date().toISOString(),
});


// ---- Uppgifter (notiser) -----------------------------------------------

/**
 * En kortsiktig uppgift på ett projekt, riktad till en person.
 *
 * Skapas i praktiken av Codex efter möten — den skriver direkt i
 * `data/<kund>.json` under projektets `tasks`-array. Därför är
 * normaliseringen i storage.ts medvetet förlåtande: saknas id eller
 * createdAt fylls de i, och ett okänt namn i `assignee` gör uppgiften
 * otilldelad istället för att kastas bort.
 */
export interface ProjectTask {
  id: string;
  text: string;
  /** Teammedlem, eller "" när uppgiften inte är tilldelad. */
  assignee: TeamMember | "";
  done: boolean;
  /** ISO-datetime när uppgiften skapades. */
  createdAt: string;
  /** ISO-datum (YYYY-MM-DD). Valfritt. */
  dueDate?: string;
}

export const newTask = (
  text = "",
  assignee: TeamMember | "" = "",
  dueDate = "",
): ProjectTask => ({
  id: `tk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  text,
  assignee,
  done: false,
  createdAt: new Date().toISOString(),
  ...(dueDate ? { dueDate } : {}),
});

// ---- To-do -------------------------------------------------------------

export interface TodoItem {
  id: string;
  /** ISO date (YYYY-MM-DD). Empty string means unscheduled. */
  startDate: string;
  /** ISO date (YYYY-MM-DD). May equal startDate for single-day tasks. */
  endDate: string;
  text: string;
  /** Assigned team member, or empty string when unassigned. */
  assignee: TeamMember | "";
  done: boolean;
}

export const newTodo = (
  startDate: string = "",
  endDate: string = "",
): TodoItem => ({
  id: `td-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  startDate,
  endDate: endDate || startDate,
  text: "",
  assignee: "",
  done: false,
});

/** Returns Monday and Sunday ISO date strings for an ISO week string. */
export function isoWeekToDateRange(
  isoWeek: string,
): { start: string; end: string } {
  const m = isoWeek.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return { start: "", end: "" };
  const year = parseInt(m[1], 10);
  const weekNum = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + (weekNum - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

/** Returns ISO week string ("YYYY-Www") for the given date. */
export function isoWeekString(d: Date): string {
  const target = new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
  );
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = target.valueOf();
  const yearOfThursday = target.getUTCFullYear();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const weekNum =
    1 + Math.round((firstThursday - target.valueOf()) / 604800000);
  return `${yearOfThursday}-W${String(weekNum).padStart(2, "0")}`;
}

// ---- Projects -----------------------------------------------------------

export type ProjectTemplate = "webb" | "sprint" | "custom";

export type ProjectStatus =
  | "active"
  | "lead"
  | "paused"
  | "done"
  | "archived";

/**
 * Visningsordning i filter-rad och i sorteringen av projekten i arket.
 * Lead ligger sist så lead-projekten alltid hamnar längst ned, vilket
 * matchar förväntan att leads är "potentiella" och inte ska störa de
 * aktiva projekten upptill.
 */
export const projectStatusOrder: readonly ProjectStatus[] = [
  "active",
  "paused",
  "done",
  "archived",
  "lead",
] as const;

export const projectStatusLabel: Record<ProjectStatus, string> = {
  active: "Aktiv",
  paused: "Pausad",
  done: "Klar",
  archived: "Arkiverad",
  lead: "Lead",
};

/** All section IDs (the things you can enable/disable per project). */
export const allSectionIds: number[] = sections.map((s) => s.id);

/**
 * Default sections enabled for each template.
 * Both templates currently expose the launch checklist; per-template
 * differentiation now lives at the phase/timeline level rather than in
 * the project-panel sections.
 */
export const templateSections: Record<Exclude<ProjectTemplate, "custom">, number[]> = {
  webb: [...allSectionIds],
  sprint: [...allSectionIds],
};

export const templateLabels: Record<ProjectTemplate, string> = {
  webb: "Webbprojekt",
  sprint: "Sprint",
  custom: "Anpassad",
};

/**
 * Beläggning per teammedlem på ett projekt. Varje allokering är sitt eget
 * objekt med en egen tidsperiod, frikopplad från projektets datum. Det
 * gör att flera personer kan jobba på samma projekt under olika perioder,
 * och att man kan dra/skapa staplar direkt i tidslinjen.
 */
export interface ProjectAllocation {
  id: string;
  member: TeamMember;
  hoursPerWeek: number;
  /** ISO YYYY-MM-DD. */
  startDate: string;
  /** ISO YYYY-MM-DD. */
  endDate: string;
}

export const newAllocation = (
  member: TeamMember,
  startDate: string,
  endDate: string,
  hoursPerWeek = 0,
): ProjectAllocation => ({
  id: `al-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  member,
  hoursPerWeek,
  startDate,
  endDate,
});

/**
 * Osäker efterfrågan som väntas uppstå någon gång under perioden, till
 * exempel support inom ett SLA. Den har en ansvarig person men räknas inte
 * som bokad tid förrän arbetet faktiskt planeras.
 */
export interface CapacityReservation {
  id: string;
  /** Ansvarig för behovet, utan att tiden är hårt allokerad. */
  member: TeamMember;
  minHours: number;
  maxHours: number;
  /** 0–1. Används för den viktade prognosen mellan min och max. */
  probability: number;
  startDate: string;
  endDate: string;
  comment: string;
}

export const newCapacityReservation = (
  startDate: string,
  endDate: string,
  member: TeamMember = teamMembers[0],
): CapacityReservation => ({
  id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  member,
  minHours: 1,
  maxHours: 4,
  probability: 0.5,
  startDate,
  endDate,
  comment: "SLA / löpande behov",
});

// ---- Beläggning: projekttyp + timallokeringar ---------------------------

/**
 * Prissättningsmodell för ett projekt. Alla tre delar samma inputstruktur
 * (timmar + datumintervall + kommentar) och samma beräkningslogik i
 * beläggningsvyn — typen är i det här steget bara en etikett.
 */
export type PricingType = "avtalade_timmar" | "fastpris" | "hogt_lagt";

export const pricingTypeOrder: readonly PricingType[] = [
  "avtalade_timmar",
  "fastpris",
  "hogt_lagt",
] as const;

export const pricingTypeLabel: Record<PricingType, string> = {
  avtalade_timmar: "Timmar avtalade",
  fastpris: "Fastpris",
  hogt_lagt: "Högt och lågt räknat",
};

/**
 * Hur `hours` på en timallokering ska tolkas:
 *  - "per_day": timmar per vardag — samma antal varje vardag i intervallet
 *    (standard i popupen).
 *  - "total": totalt antal timmar som fördelas jämnt över vardagarna.
 */
export type HourAllocationMode = "per_day" | "total";

export const hourAllocationModeLabel: Record<HourAllocationMode, string> = {
  per_day: "Per vardag",
  total: "Totalt",
};

export type RepeatUnit = "week" | "month";

export const repeatUnitLabel: Record<RepeatUnit, string> = {
  week: "Varje vecka",
  month: "Varje månad",
};

/**
 * Planerad tid för en person på ett projekt över ett datumintervall.
 * `mode` avgör om `hours` gäller per vardag eller totalt; helger räknas
 * aldrig in (se `lib/belaggning.ts`).
 *
 * Skiljer sig från `ProjectAllocation` (timmar per vecka i tidslinjen) —
 * den här modellen driver beläggningsdiagrammet på startsidan.
 */
export interface HourAllocation {
  id: string;
  member: TeamMember;
  /** Timmar — per vardag eller totalt beroende på `mode`. */
  hours: number;
  /** Fast tid eller ett trepunktsestimat. `hours` är PERT-prognosen vid range. */
  estimateMode?: "fixed" | "range";
  lowHours?: number;
  likelyHours?: number;
  highHours?: number;
  mode: HourAllocationMode;
  /**
   * Upprepade timmar: `hours` gäller per tillfälle och infaller varje vecka
   * (samma veckodag som startDate) eller varje månad (samma dag i månaden)
   * från startDate till och med endDate. Helg flyttas till nästa vardag.
   */
  repeat?: RepeatUnit;
  /** ISO YYYY-MM-DD. */
  startDate: string;
  /** ISO YYYY-MM-DD (inklusive). */
  endDate: string;
  comment: string;
  /** Vem som skapade allokeringen. Tomt tills verktyget har inloggning. */
  createdBy?: string;
  /** ISO-datetime. */
  createdAt: string;
}

export const newHourAllocation = (
  member: TeamMember,
  hours: number,
  startDate: string,
  endDate: string,
  comment = "",
  mode: HourAllocationMode = "per_day",
): HourAllocation => ({
  id: `ha-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  member,
  hours,
  mode,
  startDate,
  endDate,
  comment,
  createdAt: new Date().toISOString(),
});

export interface Project {
  id: string;
  name: string;
  template: ProjectTemplate;
  /** Livscykel-status. Default 'active'. */
  status?: ProjectStatus;
  /** Startdatum (ISO YYYY-MM-DD). */
  startDate: string;
  /** Slutdatum (ISO YYYY-MM-DD). */
  endDate: string;
  /** Section IDs that are visible/relevant for this project. */
  enabledSections: number[];
  activeSection: number;
  answers: Answers;
  checklist: ChecklistItem[];
  /** Faser (Strategi/Content/Design/Utveckling) med egna start-/slutdatum och kommentarer. */
  phases?: ProjectPhase[];
  /** Snabba veckonoteringar för måndagsmöten och liknande. */
  weeklyNotes?: WeeklyNote[];
  /** Beläggning per teammedlem (timmar/vecka under projektets löptid). */
  allocations?: ProjectAllocation[];
  /** Ansvarig men ännu ej tidsatt kapacitetsrisk. Påverkar prognos, inte bokad tid. */
  capacityReservations?: CapacityReservation[];
  /** Kortsiktiga uppgifter per person — visas på /notiser. */
  tasks?: ProjectTask[];
  /** Prissättningsmodell. Sätts första gången en timallokering skapas. */
  pricingType?: PricingType;
  /** Planerade timmar per person (totalt över intervall) — driver
   *  beläggningsdiagrammet på startsidan. */
  hourAllocations?: HourAllocation[];
  updatedAt?: string;
}

/** Daily working hours per team member (currently flat, no per-person override). */
export const DAILY_HOURS = 7;
/** Weekly working hours: 7h × 5 arbetsdagar. */
export const WEEKLY_CAPACITY = DAILY_HOURS * 5;

export const newProject = (
  name = "",
  template: ProjectTemplate = "webb",
): Project => {
  const enabled =
    template === "custom" ? [...allSectionIds] : [...templateSections[template]];
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    template,
    startDate: "",
    endDate: "",
    enabledSections: enabled,
    activeSection: enabled[0] ?? 1,
    answers: {},
    checklist: defaultChecklist.map((c) => ({ ...c })),
    capacityReservations: [],
    hourAllocations: [],
  };
};

// ---- Customers ---------------------------------------------------------

export interface CustomerData {
  client: string;
  projects: Project[];
  /** ID of currently active project (UI state, persisted for convenience). */
  activeProjectId?: string | null;
  updatedAt?: string;
}

export const emptyCustomer = (client = ""): CustomerData => ({
  client,
  projects: [],
  activeProjectId: null,
});
