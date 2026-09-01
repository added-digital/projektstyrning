"use client";

import type { CustomerData } from "./sections";
import { supabaseBrowser } from "./supabaseBrowser";

/**
 * Klientsidans prat med /api/customers. Delas av tidslinjen (`/`) och
 * notissidan (`/notiser`) så att båda laddar, pollar och sparar likadant.
 */

export interface CustomerSummary {
  slug: string;
  client: string;
}

export interface DataVersion {
  version: string;
  fileCount: number;
  latestMtimeMs: number;
}

/** Hämtar alla kunder. Kunder som inte går att läsa hoppas över. */
export async function fetchAllCustomers(): Promise<
  Record<string, CustomerData>
> {
  const listRes = await fetch("/api/customers", { cache: "no-store" });
  const list: { customers: CustomerSummary[] } = await listRes.json();
  const loaded = await Promise.all(
    list.customers.map(async (c) => {
      const res = await fetch(`/api/customers/${encodeURIComponent(c.slug)}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json: { slug: string; data: CustomerData } = await res.json();
      return json;
    }),
  );
  const all: Record<string, CustomerData> = {};
  for (const entry of loaded) {
    if (entry) all[entry.slug] = entry.data;
  }
  return all;
}

/**
 * Lättviktig fingeravtryckskoll: ändras versionen har någon skrivit i
 * JSON-filerna utanför webbläsaren (t.ex. Codex efter ett möte).
 * Returnerar null om anropet misslyckas — anroparen försöker igen.
 */
export async function fetchDataVersion(): Promise<DataVersion | null> {
  try {
    const res = await fetch("/api/customers/version", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as DataVersion;
  } catch {
    return null;
  }
}

/**
 * Prenumererar på ändringar i customers-tabellen via Supabase Realtime.
 * Ersätter den gamla 2-sekunderspollingen mot /api/customers/version:
 * varje insert/update/delete — oavsett om den kom från en annan flik,
 * en kollega eller Codex — triggar `onChange`. Kräver inloggad session
 * (RLS-policyn team_can_read styr vem som får events).
 *
 * Returnerar en unsubscribe-funktion. Anropen är debouncade med 300 ms
 * så att en skur av writes ger en enda omladdning.
 */
export function subscribeToCustomerChanges(onChange: () => void): () => void {
  let timer: number | null = null;
  let disposed = false;
  let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null =
    null;

  const client = supabaseBrowser();

  // Realtime-sockeln måste bära användarens JWT — utan den utvärderas
  // RLS som anon (noll rader → noll events). Verifierat: utan setAuth
  // levereras inga postgres_changes till authenticated.
  void client.auth.getSession().then(({ data }) => {
    if (disposed) return;
    const token = data.session?.access_token;
    if (token) void client.realtime.setAuth(token);
    channel = client
      .channel("customers-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers" },
        () => {
          if (timer !== null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            timer = null;
            onChange();
          }, 300);
        },
      )
      .subscribe();
  });

  return () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    if (channel) void client.removeChannel(channel);
  };
}

/** Sparar en kund. Returnerar serverns svar (slug kan ha bytts vid namnbyte). */
export async function saveCustomer(
  slug: string,
  data: CustomerData,
): Promise<{ slug: string; data: CustomerData } | null> {
  const res = await fetch(`/api/customers/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return (await res.json()) as { slug: string; data: CustomerData };
}
