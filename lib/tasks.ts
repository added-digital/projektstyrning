import {
  teamMembers,
  type CustomerData,
  type ProjectTask,
  type TeamMember,
} from "./sections";

/**
 * Uppgifter i sitt sammanhang. Uppgifterna bor på projekten i
 * `data/<kund>.json`; notissidan plattar ut dem och grupperar per person.
 */

export interface TaskInContext {
  task: ProjectTask;
  customer: string;
  customerSlug: string;
  projectId: string;
  projectName: string;
}

/** Nyckeln för "Ej tilldelat"-gruppen. */
export const UNASSIGNED = "";

export type TaskGroupKey = TeamMember | typeof UNASSIGNED;

export interface TaskGroup {
  key: TaskGroupKey;
  label: string;
  open: TaskInContext[];
  done: TaskInContext[];
}

export interface CollectedTasks {
  tasks: TaskInContext[];
  /** Uppgifter som ligger på arkiverade projekt och alltså inte visas. */
  hiddenArchived: number;
}

/**
 * Plattar ut alla uppgifter från alla kunder och projekt.
 *
 * Bara arkiverade projekt utelämnas — även ett projekt som är markerat
 * "Klar" kan ha en öppen uppgift kvar, och det är precis sånt en notistavla
 * ska visa. Det som ändå döljs räknas så att sidan kan säga det högt istället
 * för att tappa uppgifter tyst.
 */
export function collectTasks(
  customers: Record<string, CustomerData>,
): CollectedTasks {
  const tasks: TaskInContext[] = [];
  let hiddenArchived = 0;
  for (const slug of Object.keys(customers)) {
    const c = customers[slug];
    for (const p of c.projects) {
      const taskList = p.tasks ?? [];
      if ((p.status ?? "active") === "archived") {
        hiddenArchived += taskList.length;
        continue;
      }
      for (const task of taskList) {
        tasks.push({
          task,
          customer: c.client || slug,
          customerSlug: slug,
          projectId: p.id,
          projectName: p.name || "(utan namn)",
        });
      }
    }
  }
  return { tasks, hiddenArchived };
}

/**
 * Sortering inom en person: närmast deadline först, uppgifter utan datum
 * sist, och i övrigt äldst först (det som legat längst behöver knuffas).
 */
function byUrgency(a: TaskInContext, b: TaskInContext): number {
  const ad = a.task.dueDate ?? "";
  const bd = b.task.dueDate ?? "";
  if (ad !== bd) {
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : 1;
  }
  return (a.task.createdAt ?? "").localeCompare(b.task.createdAt ?? "");
}

/**
 * Grupperar per person i teamets ordning. Alla i teamet får en grupp även
 * utan uppgifter — tomheten är ett svar i sig på ett måndagsmöte.
 * "Ej tilldelat" läggs sist och bara när det finns något där.
 */
export function groupTasksByMember(tasks: TaskInContext[]): TaskGroup[] {
  const groups: TaskGroup[] = teamMembers.map((m) => ({
    key: m,
    label: m,
    open: [],
    done: [],
  }));
  const unassigned: TaskGroup = {
    key: UNASSIGNED,
    label: "Ej tilldelat",
    open: [],
    done: [],
  };

  for (const t of tasks) {
    const group =
      groups.find((g) => g.key === t.task.assignee) ?? unassigned;
    (t.task.done ? group.done : group.open).push(t);
  }

  for (const g of [...groups, unassigned]) {
    g.open.sort(byUrgency);
    g.done.sort(byUrgency);
  }

  return unassigned.open.length + unassigned.done.length > 0
    ? [...groups, unassigned]
    : groups;
}

/** "Försenad", "Idag", "I morgon" eller ett kort datum. */
export function dueLabel(
  dueDate: string | undefined,
  todayISO: string,
): { text: string; tone: "over" | "today" | "soon" | "normal" } | null {
  if (!dueDate) return null;
  if (dueDate < todayISO) return { text: "Försenad", tone: "over" };
  if (dueDate === todayISO) return { text: "Idag", tone: "today" };
  const tomorrow = new Date(todayISO + "T00:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (dueDate === tomorrow.toISOString().slice(0, 10)) {
    return { text: "I morgon", tone: "soon" };
  }
  const d = new Date(dueDate + "T00:00:00Z");
  const months = [
    "jan", "feb", "mar", "apr", "maj", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ];
  return {
    text: `${d.getUTCDate()} ${months[d.getUTCMonth()]}`,
    tone: "normal",
  };
}
