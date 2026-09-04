"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MainNav } from "@/components/MainNav";
import { FortnoxPanel } from "@/components/FortnoxPanel";
import { WorkerMapping } from "@/components/WorkerMapping";
import { HoursChart } from "@/components/HoursChart";
import { defaultRange, pivotBuckets, fmtHours, type Period } from "@/lib/hours";
import {
  fetchFortnoxStatus,
  fetchHours,
  fetchWorkers,
  subscribeToTidChanges,
  type FortnoxStatus,
  type UnmappedUser,
  type Worker,
} from "@/lib/tidClient";
import type { HoursBucket } from "@/lib/hours";

const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "Vecka" },
  { value: "month", label: "Månad" },
  { value: "year", label: "År" },
];

export default function TidPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [includeAbsence, setIncludeAbsence] = useState(false);
  const [buckets, setBuckets] = useState<HoursBucket[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedUser[]>([]);
  const [status, setStatus] = useState<FortnoxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMapping, setShowMapping] = useState(false);

  const range = useMemo(() => defaultRange(period, new Date()), [period]);
  const codes = useMemo(
    () => (includeAbsence ? ["TID", "SEM", "VAB", "SJK", "FPE", "TJL", "PER"] : ["TID"]),
    [includeAbsence],
  );

  const loadHours = useCallback(async () => {
    try {
      const res = await fetchHours(period, range.from, range.to, codes);
      setBuckets(res.buckets);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [period, range, codes]);

  const loadMeta = useCallback(async () => {
    try {
      const [w, s] = await Promise.all([fetchWorkers(), fetchFortnoxStatus()]);
      setWorkers(w.workers);
      setUnmapped(w.unmapped);
      setStatus(s);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadHours(), loadMeta()]).finally(() => setLoading(false));
  }, [loadHours, loadMeta]);

  // Synk klar / mappning ändrad → ladda om både meta och timmar.
  useEffect(
    () =>
      subscribeToTidChanges(() => {
        void loadMeta();
        void loadHours();
      }),
    [loadMeta, loadHours],
  );

  const pivot = useMemo(
    () => pivotBuckets(buckets, period, workers.map((w) => w.name)),
    [buckets, period, workers],
  );
  const total = pivot.rows.reduce((n, r) => n + r.total, 0);
  const unmappedInChart = pivot.series.some((s) => s.startsWith("Okopplad"));

  return (
    <>
      <div className="page-toolbar">
        <div className="page-toolbar-inner">
          <MainNav />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
        <FortnoxPanel status={status} onChanged={loadMeta} />

        <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="hours-h">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="hours-h" className="m-0 text-[13px] font-semibold">
              Rapporterad tid per medarbetare
            </h2>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {range.from} → {range.to} · {fmtHours(total)} h totalt
            </span>

            <div className="ml-auto flex items-center gap-3">
              <div role="group" aria-label="Period" className="inline-flex overflow-hidden rounded-md border border-border">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={period === p.value}
                    onClick={() => setPeriod(p.value)}
                    className={`cursor-pointer px-3 py-1 text-[12.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                      period === p.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeAbsence}
                  onChange={(e) => setIncludeAbsence(e.target.checked)}
                />
                Inkl. frånvaro
              </label>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-[12.5px] text-destructive">
              {error}
            </p>
          )}

          {loading ? (
            <p className="mt-6 text-[12.5px] text-muted-foreground">Hämtar tid…</p>
          ) : pivot.rows.length === 0 ? (
            <p className="mt-6 text-[12.5px] text-muted-foreground">
              Ingen tid i intervallet.{" "}
              {status?.connected
                ? "Kör en synk för att hämta från Fortnox."
                : "Koppla Fortnox och kör en backfill för att komma igång."}
            </p>
          ) : (
            <HoursChart pivot={pivot} period={period} />
          )}

          {unmappedInChart && (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Det finns tid från Fortnox-användare som inte är kopplade till någon medarbetare —{" "}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit underline underline-offset-2"
                onClick={() => setShowMapping(true)}
              >
                koppla dem
              </button>
              .
            </p>
          )}
        </section>

        <div>
          <button
            type="button"
            className="btn btn-mute cursor-pointer"
            aria-expanded={showMapping}
            onClick={() => setShowMapping((v) => !v)}
          >
            {showMapping ? "Dölj mappning" : "Medarbetare ↔ Fortnox"}
          </button>
        </div>
        {showMapping && (
          <WorkerMapping workers={workers} unmapped={unmapped} onChanged={loadMeta} />
        )}
      </main>
    </>
  );
}
