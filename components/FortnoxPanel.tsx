"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { FortnoxStatus, SyncRun } from "@/lib/tidClient";
import { triggerSync } from "@/lib/tidClient";
import { showToast } from "@/components/Toast";

interface Props {
  status: FortnoxStatus | null;
  onChanged: () => void;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

function RunRow({ run }: { run: SyncRun }) {
  const icon =
    run.status === "running" ? (
      <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />
    ) : run.status === "ok" ? (
      <CheckCircle2 size={13} aria-hidden />
    ) : (
      <AlertCircle size={13} aria-hidden />
    );
  const label = run.status === "running" ? "Synkar" : run.status === "ok" ? "Klar" : "Fel";
  return (
    <li className="grid grid-cols-[6.5rem_1fr_auto] items-baseline gap-3 border-t border-border py-2 text-[12.5px] first:border-t-0">
      <span className="tabular-nums text-muted-foreground">{fmtTime(run.started_at)}</span>
      <span>
        {run.from_date} → {run.to_date}
        <span className="text-muted-foreground"> · {run.trigger === "nightly" ? "natt" : "manuell"}</span>
        {run.status === "ok" && (
          <span className="text-muted-foreground tabular-nums">
            {" "}· {run.entries_upserted} rader{run.entries_deleted > 0 ? `, ${run.entries_deleted} borttagna` : ""}
          </span>
        )}
        {run.status === "error" && run.error && (
          <span className="block text-destructive">{run.error}</span>
        )}
      </span>
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </span>
    </li>
  );
}

/**
 * Fortnox-koppling + synk. Systemstatus är alltid synlig: kopplad/ej,
 * senaste körning, pågående körning. Backfill går tillbaka till 2026-01-01.
 */
export function FortnoxPanel({ status, onChanged }: Props) {
  const [busy, setBusy] = useState<"none" | "sync" | "backfill">("none");
  const running = status?.runs.some((r) => r.status === "running") ?? false;

  async function run(kind: "sync" | "backfill") {
    setBusy(kind);
    try {
      const res = await triggerSync(kind === "backfill" ? "2026-01-01" : undefined);
      if (res.error) showToast(`Synk misslyckades: ${res.error}`);
      else showToast(kind === "backfill" ? "Backfill från 2026-01-01 klar" : "Synk klar");
      onChanged();
    } catch (err) {
      showToast(`Synk misslyckades: ${String(err)}`);
    } finally {
      setBusy("none");
    }
  }

  if (!status) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="fortnox-h">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="fortnox-h" className="m-0 text-[13px] font-semibold">
          Fortnox
        </h2>
        {status.connected ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <CheckCircle2 size={13} aria-hidden /> Kopplad
            {status.connection?.consented_by ? ` av ${status.connection.consented_by}` : ""}
            {" · "}senast synkad {fmtTime(status.connection?.last_sync_at ?? null)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <AlertCircle size={13} aria-hidden /> Inte kopplad
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {status.connected ? (
            <>
              <button
                type="button"
                className="btn btn-mute cursor-pointer"
                onClick={() => run("sync")}
                disabled={busy !== "none" || running}
              >
                {busy === "sync" || running ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <RefreshCw size={14} aria-hidden />
                )}{" "}
                Synka nu
              </button>
              <button
                type="button"
                className="btn btn-mute cursor-pointer"
                onClick={() => {
                  if (window.confirm("Hämta om all tid från 2026-01-01? Befintliga rader uppdateras, borttagna i Fortnox försvinner.")) {
                    void run("backfill");
                  }
                }}
                disabled={busy !== "none" || running}
              >
                Backfill från 2026
              </button>
            </>
          ) : (
            <a href="/api/fortnox/connect" className="btn cursor-pointer">
              Koppla Fortnox
            </a>
          )}
        </div>
      </div>

      {!status.connected && (
        <p className="mt-3 max-w-prose text-[12.5px] text-muted-foreground">
          Kopplingen görs en gång av en Fortnox-systemadministratör och ger ett
          service account med enbart tidrapporterings-scope. Inga personliga
          inloggningar sparas.
        </p>
      )}

      {status.runs.length > 0 && (
        <ul className="mt-3 list-none p-0">
          {status.runs.slice(0, 5).map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </ul>
      )}
    </section>
  );
}
