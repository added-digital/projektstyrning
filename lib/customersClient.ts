"use client";

import type { CustomerData } from "./sections";

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
