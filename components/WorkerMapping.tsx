"use client";

import { useState } from "react";
import { patchWorker, type UnmappedUser, type Worker } from "@/lib/tidClient";
import { fmtHours } from "@/lib/hours";
import { showToast } from "@/components/Toast";

interface Props {
  workers: Worker[];
  unmapped: UnmappedUser[];
  onChanged: () => void;
}

/**
 * Mappning Fortnox-användare → medarbetare. Fortnox API:t saknar
 * users-endpoint, så id:n kopplas för hand — men okopplade id:n som
 * förekommer i tiden listas med timmar och senaste datum, så det går
 * att gissa rätt ("312 h senast igår" är nog inte praktikanten).
 */
export function WorkerMapping({ workers, unmapped, onChanged }: Props) {
  const [saving, setSaving] = useState<string | null>(null);

  async function assign(workerId: string, fortnoxUserId: string | null) {
    setSaving(workerId);
    try {
      await patchWorker(workerId, fortnoxUserId);
      showToast(fortnoxUserId ? "Kopplad" : "Koppling borttagen");
      onChanged();
    } catch (err) {
      showToast(`Kunde inte spara: ${String(err)}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="mapping-h">
      <h2 id="mapping-h" className="m-0 text-[13px] font-semibold">
        Medarbetare ↔ Fortnox
      </h2>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Medarbetare</th>
              <th className="py-1.5 pr-3 font-medium">Fortnox-användar-id</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-t border-border">
                <td className="py-2 pr-3">
                  <label htmlFor={`fx-${w.id}`}>{w.name}</label>
                </td>
                <td className="py-2 pr-3">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = new FormData(e.currentTarget).get("id");
                      void assign(w.id, typeof v === "string" && v.trim() ? v.trim() : null);
                    }}
                  >
                    <input
                      id={`fx-${w.id}`}
                      name="id"
                      defaultValue={w.fortnox_user_id ?? ""}
                      placeholder="t.ex. 42"
                      className="w-28 rounded-md border border-input bg-secondary px-2 py-1 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      disabled={saving === w.id}
                    />
                    <button
                      type="submit"
                      className="btn btn-mute cursor-pointer"
                      disabled={saving === w.id}
                    >
                      Spara
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmapped.length > 0 && (
        <div className="mt-4">
          <h3 className="m-0 text-[12px] font-medium text-muted-foreground">
            Okopplade Fortnox-användare i tiden
          </h3>
          <ul className="mt-2 list-none p-0 text-[12.5px]">
            {unmapped.map((u) => (
              <li key={u.fortnox_user_id} className="flex flex-wrap items-center gap-3 border-t border-border py-2 first:border-t-0">
                <code className="rounded bg-secondary px-1.5 py-0.5 text-[12px]">{u.fortnox_user_id}</code>
                <span className="tabular-nums text-muted-foreground">
                  {fmtHours(u.hours)} h · {u.entries} rader · senast {u.latest}
                </span>
                <label className="ml-auto flex items-center gap-2">
                  <span className="sr-only">Koppla {u.fortnox_user_id} till</span>
                  <select
                    className="cursor-pointer rounded-md border border-input bg-secondary px-2 py-1 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) void assign(e.target.value, u.fortnox_user_id);
                    }}
                  >
                    <option value="">Koppla till…</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
