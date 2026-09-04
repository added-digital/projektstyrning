"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { MainNav } from "@/components/MainNav";
import { showToast } from "@/components/Toast";
import { saveCustomer, subscribeToCustomerChanges } from "@/lib/customersClient";
import {
  newProject,
  pricingTypeLabel,
  pricingTypeOrder,
  projectStatusLabel,
  projectStatusOrder,
  type CustomerData,
  type PricingType,
  type Project,
  type ProjectStatus,
} from "@/lib/sections";

const inputCls =
  "panel-text-input w-full";

/**
 * Redigera en kund och dess projekt direkt: namn, status, projekttyp,
 * datum. Sparar hela kunddokumentet via PUT (samma väg som beläggningsvyn),
 * så planerad tid på projekten följer med orört.
 */
export default function KundPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [data, setData] = useState<CustomerData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentSlug, setCurrentSlug] = useState(slug);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/${encodeURIComponent(currentSlug)}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const json = (await res.json()) as { data: CustomerData };
    setData(json.data);
    setDirty(false);
  }, [currentSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Andras ändringar: ladda om om vi själva inte har osparat.
  useEffect(
    () =>
      subscribeToCustomerChanges(() => {
        if (!dirty && !saving) void load();
      }),
    [dirty, saving, load],
  );

  function patch(next: CustomerData) {
    setData(next);
    setDirty(true);
  }

  function patchProject(id: string, p: Partial<Project>) {
    if (!data) return;
    patch({ ...data, projects: data.projects.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const saved = await saveCustomer(currentSlug, data);
      if (!saved) {
        showToast("Kunde inte spara");
        return;
      }
      setData(saved.data);
      setDirty(false);
      showToast("Sparat");
      if (saved.slug !== currentSlug) {
        // Namnbyte → ny slug; följ med i URL:en.
        setCurrentSlug(saved.slug);
        router.replace(`/kunder/${saved.slug}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer() {
    if (!data) return;
    const n = data.projects.length;
    if (!window.confirm(`Ta bort kunden ${data.client}${n ? ` och ${n} projekt` : ""}? Det går inte att ångra.`)) return;
    const res = await fetch(`/api/customers/${encodeURIComponent(currentSlug)}`, { method: "DELETE" });
    if (!res.ok) {
      showToast("Kunde inte ta bort kunden");
      return;
    }
    showToast("Kunden är borttagen");
    router.push("/kunder");
  }

  function removeProject(p: Project) {
    if (!data) return;
    const planned = (p.hourAllocations ?? []).length + (p.capacityReservations ?? []).length;
    if (!window.confirm(`Ta bort projektet ${p.name || "(utan namn)"}${planned ? ` inklusive ${planned} planerade poster` : ""}?`)) return;
    patch({ ...data, projects: data.projects.filter((x) => x.id !== p.id) });
  }

  function addProject() {
    if (!data) return;
    const p = newProject("Nytt projekt");
    patch({ ...data, projects: [...data.projects, p], activeProjectId: p.id });
  }

  return (
    <>
      <div className="page-toolbar">
        <div className="page-toolbar-inner">
          <Link href="/kunder" className="btn btn-mute toolbar-btn">← Kunder</Link>
          <h1 className="bpp-title">{data?.client || slug}</h1>
          <div className="toolbar-spacer" />
          {dirty && <span className="text-[12px] text-muted-foreground">Osparade ändringar</span>}
          <button type="button" className="btn toolbar-btn" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Sparar…" : "Spara"}
          </button>
          <MainNav />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5">
        {notFound ? (
          <p className="text-[12.5px] text-muted-foreground">Kunden finns inte. <Link href="/kunder">Till kundlistan</Link></p>
        ) : !data ? (
          <p className="text-[12.5px] text-muted-foreground">Hämtar…</p>
        ) : (
          <>
            <section className="rounded-lg border border-border bg-card p-4">
              <label htmlFor="kund-namn" className="meta-label">Kundnamn</label>
              <input
                id="kund-namn"
                className={`${inputCls} max-w-md`}
                value={data.client}
                onChange={(e) => patch({ ...data, client: e.target.value })}
              />
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Byter du namn ändras kundens adress (slug) vid sparning.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <h2 className="m-0 text-[13px] font-semibold">Projekt</h2>
                <button type="button" className="btn btn-mute ml-auto cursor-pointer" onClick={addProject}>
                  <Plus size={13} aria-hidden /> Nytt projekt
                </button>
              </div>

              {data.projects.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">Inga projekt än.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[52rem] border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">Namn</th>
                        <th className="py-1.5 pr-3 font-medium">Status</th>
                        <th className="py-1.5 pr-3 font-medium">Projekttyp</th>
                        <th className="py-1.5 pr-3 font-medium">Start</th>
                        <th className="py-1.5 pr-3 font-medium">Slut</th>
                        <th className="py-1.5 pr-3 font-medium">Planerat</th>
                        <th className="py-1.5 font-medium"><span className="sr-only">Ta bort</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map((p) => (
                        <tr key={p.id} className="border-t border-border align-middle">
                          <td className="py-2 pr-3">
                            <label className="sr-only" htmlFor={`pn-${p.id}`}>Projektnamn</label>
                            <input id={`pn-${p.id}`} className={inputCls} value={p.name} onChange={(e) => patchProject(p.id, { name: e.target.value })} />
                          </td>
                          <td className="py-2 pr-3">
                            <label className="sr-only" htmlFor={`ps-${p.id}`}>Status</label>
                            <select id={`ps-${p.id}`} className={inputCls} value={p.status ?? "active"} onChange={(e) => patchProject(p.id, { status: e.target.value as ProjectStatus })}>
                              {projectStatusOrder.map((s) => (
                                <option key={s} value={s}>{projectStatusLabel[s]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <label className="sr-only" htmlFor={`pt-${p.id}`}>Projekttyp</label>
                            <select id={`pt-${p.id}`} className={inputCls} value={p.pricingType ?? ""} onChange={(e) => patchProject(p.id, { pricingType: (e.target.value || undefined) as PricingType | undefined })}>
                              <option value="">—</option>
                              {pricingTypeOrder.map((t) => (
                                <option key={t} value={t}>{pricingTypeLabel[t]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <label className="sr-only" htmlFor={`pa-${p.id}`}>Startdatum</label>
                            <input id={`pa-${p.id}`} type="date" className={inputCls} value={p.startDate} onChange={(e) => patchProject(p.id, { startDate: e.target.value })} />
                          </td>
                          <td className="py-2 pr-3">
                            <label className="sr-only" htmlFor={`pb-${p.id}`}>Slutdatum</label>
                            <input id={`pb-${p.id}`} type="date" className={inputCls} value={p.endDate} onChange={(e) => patchProject(p.id, { endDate: e.target.value })} />
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                            {(p.hourAllocations ?? []).length} poster
                          </td>
                          <td className="py-2 text-right">
                            <button type="button" className="icon-btn danger cursor-pointer" aria-label={`Ta bort ${p.name || "projektet"}`} title="Ta bort projekt" onClick={() => removeProject(p)}>
                              <Trash2 size={13} aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="m-0 text-[13px] font-semibold">Ta bort kund</h2>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Tar bort kunden, alla projekt och all planerad tid. Rapporterad Fortnox-tid påverkas inte.
              </p>
              <button type="button" className="btn btn-mute mt-3 cursor-pointer" onClick={() => void removeCustomer()}>
                <Trash2 size={13} aria-hidden /> Ta bort {data.client || "kunden"}
              </button>
            </section>
          </>
        )}
      </main>
    </>
  );
}
