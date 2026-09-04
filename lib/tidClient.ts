"use client";

import type { HoursBucket, Period } from "./hours";
import { supabaseBrowser } from "./supabaseBrowser";

export interface Worker {
  id: string;
  name: string;
  fortnox_user_id: string | null;
  active: boolean;
  sort: number;
}

export interface UnmappedUser {
  fortnox_user_id: string;
  hours: number;
  latest: string;
  entries: number;
}

export interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  from_date: string;
  to_date: string;
  trigger: "nightly" | "manual";
  entries_upserted: number;
  entries_deleted: number;
  status: "running" | "ok" | "error";
  error: string | null;
}

export interface FortnoxStatus {
  connected: boolean;
  connection: {
    consented_at: string;
    consented_by: string | null;
    scopes: string[];
    last_sync_at: string | null;
    last_sync_status: string | null;
  } | null;
  runs: SyncRun[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export function fetchHours(period: Period, from: string, to: string, codes: string[]) {
  const q = new URLSearchParams({ period, from, to, codes: codes.join(",") });
  return getJson<{ buckets: HoursBucket[] }>(`/api/tid?${q}`);
}

export function fetchWorkers() {
  return getJson<{ workers: Worker[]; unmapped: UnmappedUser[] }>("/api/workers");
}

export function fetchFortnoxStatus() {
  return getJson<FortnoxStatus>("/api/fortnox/status");
}

export async function patchWorker(id: string, fortnoxUserId: string | null): Promise<Worker> {
  const res = await fetch("/api/workers", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, fortnox_user_id: fortnoxUserId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.worker as Worker;
}

export async function triggerSync(from?: string): Promise<{ runId?: string; error?: string }> {
  const res = await fetch("/api/fortnox/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(from ? { from } : {}),
  });
  return res.json();
}

/** Realtime på sync_runs + workers: synkstatus och mappningar uppdateras live. */
export function subscribeToTidChanges(onChange: () => void): () => void {
  let disposed = false;
  let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null = null;
  const client = supabaseBrowser();
  void client.auth.getSession().then(({ data }) => {
    if (disposed) return;
    const token = data.session?.access_token;
    if (token) void client.realtime.setAuth(token);
    channel = client
      .channel("tid-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_runs" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, onChange)
      .subscribe();
  });
  return () => {
    disposed = true;
    if (channel) void client.removeChannel(channel);
  };
}
