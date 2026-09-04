"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MainNav } from "@/components/MainNav";
import { fetchAllCustomers, subscribeToCustomerChanges } from "@/lib/customersClient";
import { projectStatusLabel, pricingTypeLabel, type CustomerData } from "@/lib/sections";

/** Kundlista: en rad per kund, projekten som chips, klick → /kunder/[slug]. */
export default function KunderPage() {
  const [customers, setCustomers] = useState<Record<string, CustomerData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    try {
      setCustomers(await fetchAllCustomers());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return subscribeToCustomerChanges(() => void load());
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.entries(customers)
      .map(([slug, c]) => ({ slug, name: c.client || slug, projects: c.projects }))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.projects.some((p) => p.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }, [customers, q]);

  return (
    <>
      <div className="page-toolbar">
        <div className="page-toolbar-inner">
          <h1 className="bpp-title">Kunder</h1>
          <MainNav />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5">
        <div className="flex items-center gap-3">
          <label htmlFor="kund-sok" className="text-[12px] text-muted-foreground">Sök</label>
          <input
            id="kund-sok"
            className="panel-text-input w-72"
            placeholder="Kund eller projekt…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
            {rows.length} kunder · {rows.reduce((n, r) => n + r.projects.length, 0)} projekt
          </span>
        </div>

        {error && <p role="alert" className="text-[12.5px] text-destructive">{error}</p>}
        {loading ? (
          <p className="text-[12.5px] text-muted-foreground">Hämtar kunder…</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border overflow-hidden rounded-lg border border-border bg-card p-0">
            {rows.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/kunder/${r.slug}`}
                  className="grid cursor-pointer grid-cols-[14rem_1fr] items-baseline gap-4 px-4 py-3 no-underline hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-[13px] font-semibold text-foreground">{r.name}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {r.projects.length === 0 && (
                      <span className="text-[12px] text-muted-foreground">Inga projekt</span>
                    )}
                    {r.projects.map((p) => (
                      <span
                        key={p.id}
                        className="rounded border border-border px-1.5 py-0.5 text-[11.5px] text-muted-foreground"
                        title={`${projectStatusLabel[p.status ?? "active"]}${p.pricingType ? ` · ${pricingTypeLabel[p.pricingType]}` : ""}`}
                      >
                        {p.name || "(utan namn)"}
                        <span className="opacity-60"> · {projectStatusLabel[p.status ?? "active"]}</span>
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
