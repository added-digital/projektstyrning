"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  checklistCategoryOrder,
  checklistSuggestions,
  defaultChecklist,
  newPhase,
  phaseOrder,
  projectStatusLabel,
  projectStatusOrder,
  sections,
  type ChecklistCategory,
  type ChecklistItem,
  type CustomerData,
  type PhaseType,
  type Project,
  type ProjectPhase,
  type ProjectStatus,
} from "@/lib/sections";
import { DatePicker } from "./DatePicker";
import { showToast } from "./Toast";
import { Check, ChevronUp, Plus, X } from "lucide-react";

type Tab = "overview" | "checklist";

const SECTION_ID = {
  checklist: 6,
} as const;

export interface ProjectPanelProps {
  customer: CustomerData;
  customerSlug: string;
  project: Project;
  onClose: () => void;
  onPatchProject: (patch: Partial<Project>) => void;
  onPatchCustomer: (patch: Partial<CustomerData>) => void;
  onDeleteProject: () => void;
}

export function ProjectPanel({
  customer,
  customerSlug: _customerSlug,
  project,
  onClose,
  onPatchProject,
  onPatchCustomer,
  onDeleteProject,
}: ProjectPanelProps) {
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Section availability per project's enabledSections
  function isEnabled(sectionId: number): boolean {
    return project.enabledSections.includes(sectionId);
  }

  // Auto-switch off a disabled tab if user disables it
  useEffect(() => {
    if (tab === "checklist" && !isEnabled(SECTION_ID.checklist))
      setTab("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.enabledSections]);


  function exportMarkdown() {
    let md = `# ${customer.client || "—"} — ${project.name || "—"}\n\n`;
    if (project.startDate) md += `**Startdatum:** ${project.startDate}  \n`;
    if (project.endDate) md += `**Slutdatum:** ${project.endDate}  \n`;
    md += `\n---\n\n`;

    // Phases
    if (project.phases && project.phases.length > 0) {
      md += `## Faser\n\n`;
      const ordered = project.phases.slice().sort(
        (a, b) => phaseOrder.indexOf(a.type) - phaseOrder.indexOf(b.type),
      );
      for (const ph of ordered) {
        md += `### ${ph.type} — ${ph.startDate || "?"} → ${ph.endDate || "pågående"}\n\n`;
        for (const c of ph.comments ?? []) {
          const tags: string[] = [];
          if (c.category) tags.push(c.category);
          if (c.assignees && c.assignees.length > 0) tags.push(...c.assignees);
          const meta = tags.length > 0 ? ` — ${tags.join(", ")}` : "";
          md += `- [${c.done ? "x" : " "}] ${c.text}${meta}\n`;
        }
        md += `\n`;
      }
    }

    if (isEnabled(SECTION_ID.checklist)) {
      md += `## Checklista\n\n`;
      if (project.checklist.length === 0) md += `_(inga punkter)_\n\n`;
      else {
        for (const cat of checklistCategoryOrder) {
          const inCat = project.checklist.filter((c) => c.category === cat);
          if (inCat.length === 0) continue;
          md += `### ${cat}\n\n`;
          for (const c of inCat) {
            md += `- [${c.done ? "x" : " "}] ${c.label}\n`;
          }
          md += `\n`;
        }
      }
    }

    const fallback = () => {
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(customer.client)}-${slugify(project.name)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Nedladdad");
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md).then(
        () => showToast("Kopierat till urklipp"),
        () => fallback(),
      );
    } else {
      fallback();
    }
  }

  return (
    <div
      className="alloc-popover-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${project.name || "Projekt"}`}
    >
      <div
        className="project-inline-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="project-inline-header">
          <div className="project-inline-titlewrap">
            <div className="project-inline-eyebrow">{customer.client}</div>
            <div className="project-inline-title">
              {project.name || "(utan namn)"}
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
        </header>

        <nav className="project-inline-tabs">
          <TabButton
            id="overview"
            current={tab}
            onClick={() => setTab("overview")}
          >
            Översikt
          </TabButton>
          {isEnabled(SECTION_ID.checklist) && (
            <TabButton
              id="checklist"
              current={tab}
              onClick={() => setTab("checklist")}
            >
              Checklista
            </TabButton>
          )}
        </nav>

        <div className="project-inline-body">
          {tab === "overview" && (
            <OverviewTab
              customer={customer}
              project={project}
              onPatchProject={onPatchProject}
              onPatchCustomer={onPatchCustomer}
              onDeleteProject={onDeleteProject}
              onExport={exportMarkdown}
            />
          )}
          {tab === "checklist" && isEnabled(SECTION_ID.checklist) && (
            <ChecklistTab project={project} onPatchProject={onPatchProject} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  id,
  current,
  onClick,
  children,
}: {
  id: Tab;
  current: Tab;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const active = id === current;
  return (
    <button
      type="button"
      className={`project-inline-tab ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Overview tab ----------------------------------------------------------

function OverviewTab({
  customer,
  project,
  onPatchProject,
  onPatchCustomer,
  onDeleteProject,
  onExport,
}: {
  customer: CustomerData;
  project: Project;
  onPatchProject: (patch: Partial<Project>) => void;
  onPatchCustomer: (patch: Partial<CustomerData>) => void;
  onDeleteProject: () => void;
  onExport: () => void;
}) {
  function toggleSection(id: number) {
    const set = new Set(project.enabledSections);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onPatchProject({
      enabledSections: sections.map((s) => s.id).filter((i) => set.has(i)),
    });
  }

  function addPhase(type: PhaseType) {
    const np = newPhase(type);
    if (type === "Strategi" && project.startDate) np.startDate = project.startDate;
    onPatchProject({ phases: [...(project.phases ?? []), np] });
  }

  function addAllPhases() {
    const existing = new Set((project.phases ?? []).map((p) => p.type));
    const toAdd = phaseOrder.filter((t) => !existing.has(t));
    if (toAdd.length === 0) return;
    const newOnes = toAdd.map((t) => {
      const np = newPhase(t);
      if (t === "Strategi" && project.startDate) np.startDate = project.startDate;
      return np;
    });
    onPatchProject({ phases: [...(project.phases ?? []), ...newOnes] });
  }

  function updatePhase(id: string, patch: Partial<ProjectPhase>) {
    onPatchProject({
      phases: (project.phases ?? []).map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  }

  function removePhase(id: string) {
    onPatchProject({
      phases: (project.phases ?? []).filter((p) => p.id !== id),
    });
  }

  const allPhasesPresent = phaseOrder.every((t) =>
    (project.phases ?? []).some((p) => p.type === t),
  );

  return (
    <div className="panel-tab-content">
      <section className="panel-section">
        <label className="meta-label" htmlFor="cust-name">
          Kund
        </label>
        <input
          id="cust-name"
          type="text"
          className="panel-text-input"
          value={customer.client}
          onChange={(e) => onPatchCustomer({ client: e.target.value })}
          placeholder="Kundens namn"
        />
      </section>

      <section className="panel-section">
        <label className="meta-label" htmlFor="proj-name">
          Projektnamn
        </label>
        <input
          id="proj-name"
          type="text"
          className="panel-text-input"
          value={project.name}
          onChange={(e) => onPatchProject({ name: e.target.value })}
          placeholder="(utan namn)"
        />
      </section>

      <section className="panel-section">
        <label className="meta-label">Status</label>
        <div className="status-chips" role="group" aria-label="Projektstatus">
          {projectStatusOrder.map((s) => {
            const active = (project.status ?? "active") === s;
            return (
              <button
                type="button"
                key={s}
                className={`status-chip status-${s} ${active ? "on" : ""}`}
                onClick={() => onPatchProject({ status: s })}
                aria-pressed={active}
              >
                {projectStatusLabel[s]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel-section panel-section-grid">
        <div>
          <label className="meta-label">Startdatum</label>
          <DatePicker
            value={project.startDate}
            onChange={(v) => onPatchProject({ startDate: v })}
            ariaLabel="Projektets startdatum"
            placeholder="Välj startdatum"
          />
        </div>
        <div>
          <label className="meta-label">Slutdatum</label>
          <DatePicker
            value={project.endDate}
            onChange={(v) => onPatchProject({ endDate: v })}
            ariaLabel="Projektets slutdatum"
            placeholder="Välj slutdatum"
          />
        </div>
      </section>

      <section className="panel-section panel-actions">
        <button type="button" className="btn" onClick={onExport}>
          Exportera markdown
        </button>
        <button
          type="button"
          className="btn btn-mute danger"
          onClick={onDeleteProject}
        >
          Ta bort projekt
        </button>
      </section>
    </div>
  );
}

// ---- Checklist tab ---------------------------------------------------------

function ChecklistTab({
  project,
  onPatchProject,
}: {
  project: Project;
  onPatchProject: (patch: Partial<Project>) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<ChecklistCategory>>(new Set());

  function toggleCollapsed(cat: ChecklistCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleItem(id: string) {
    onPatchProject({
      checklist: project.checklist.map((c) =>
        c.id === id ? { ...c, done: !c.done } : c,
      ),
    });
  }

  function updateLabel(id: string, label: string) {
    onPatchProject({
      checklist: project.checklist.map((c) =>
        c.id === id ? { ...c, label } : c,
      ),
    });
  }

  function removeItem(id: string) {
    onPatchProject({
      checklist: project.checklist.filter((c) => c.id !== id),
    });
  }

  function addItem(label: string, category: ChecklistCategory) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    onPatchProject({
      checklist: [
        ...project.checklist,
        { id, label: trimmed, done: false, category },
      ],
    });
  }

  function resetCategoryDefaults(category: ChecklistCategory) {
    const defaults = defaultChecklist.filter((d) => d.category === category);
    const existingLabels = new Set(
      project.checklist
        .filter((c) => c.category === category)
        .map((c) => c.label.trim().toLowerCase()),
    );
    const toAdd = defaults.filter(
      (d) => !existingLabels.has(d.label.trim().toLowerCase()),
    );
    if (toAdd.length === 0) return;
    onPatchProject({
      checklist: [...project.checklist, ...toAdd.map((d) => ({ ...d }))],
    });
  }

  return (
    <div className="panel-tab-content">
      <h2 className="panel-tab-title">Checklista</h2>
      <div className="checklist">
        {checklistCategoryOrder.map((cat) => {
          const inCat = project.checklist.filter((c) => c.category === cat);
          const done = inCat.filter((c) => c.done).length;
          const isCollapsed = collapsed.has(cat);
          return (
            <section className="check-cat" key={cat}>
              <button
                type="button"
                className={`check-cat-header ${isCollapsed ? "collapsed" : ""}`}
                onClick={() => toggleCollapsed(cat)}
                aria-expanded={!isCollapsed}
              >
                <span className="cat-arrow" aria-hidden>
                  <ChevronUp size={14} strokeWidth={2.25} />
                </span>
                <span className="cat-title">{cat}</span>
                <span className="section-count">
                  {done}/{inCat.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="check-cat-body">
                  {inCat.length === 0 ? (
                    <div className="empty-state inline">
                      Inga punkter än.
                      <button
                        type="button"
                        className="btn btn-mute small inline-action"
                        onClick={() => resetCategoryDefaults(cat)}
                      >
                        <Plus size={12} strokeWidth={2.25} aria-hidden /> Lägg till förslag
                      </button>
                    </div>
                  ) : (
                    <ul className="checklist-list">
                      {inCat.map((c) => (
                        <li
                          className={`check-item ${c.done ? "done" : ""}`}
                          key={c.id}
                        >
                          <button
                            type="button"
                            className="checkbox"
                            onClick={() => toggleItem(c.id)}
                            aria-pressed={c.done}
                            aria-label={c.done ? "Avmarkera" : "Markera klar"}
                          >
                            {c.done && <Check size={12} strokeWidth={2.75} aria-hidden />}
                          </button>
                          <input
                            type="text"
                            className="check-label"
                            value={c.label}
                            onChange={(e) => updateLabel(c.id, e.target.value)}
                          />
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => removeItem(c.id)}
                            aria-label="Ta bort"
                          >
                            <X size={14} strokeWidth={2.25} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <SimpleChecklistAdder
                    category={cat}
                    onAdd={(label) => addItem(label, cat)}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SimpleChecklistAdder({
  category,
  onAdd,
}: {
  category: ChecklistCategory;
  onAdd: (label: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  function commit(label: string) {
    if (!label.trim()) return;
    onAdd(label.trim());
    setDraft("");
  }

  const suggestions = useMemo(
    () =>
      (checklistSuggestions[category] ?? []).filter((s) => {
        if (!draft.trim()) return false;
        return s.toLowerCase().includes(draft.trim().toLowerCase());
      }),
    [category, draft],
  );

  return (
    <div className="check-adder">
      <div className="check-adder-input">
        <input
          type="text"
          placeholder={`Lägg till punkt i ${category}…`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
          }}
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <ul className="check-adder-list">
          {suggestions.slice(0, 8).map((s) => (
            <li
              key={s}
              className="check-adder-option"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
