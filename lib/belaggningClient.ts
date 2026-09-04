"use client";

import type { OccupancySeries } from "./belaggning";

/**
 * Klientsidans prat med /api/belaggning. Frontend vet bara om den här
 * endpointen — inte om en dags siffra kommer från stub, Fortnox eller en
 * allokering (det syns bara i `source`-fältet på punkten).
 */

export interface BelaggningData {
  from: string;
  to: string;
  today: string;
  series: OccupancySeries[];
}

export async function fetchBelaggning(
  from: string,
  to: string,
  personId?: string,
): Promise<BelaggningData> {
  const params = new URLSearchParams({ from, to });
  if (personId) params.set("person_id", personId);
  const res = await fetch(`/api/belaggning?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      // Inget JSON-fel — behåll statuskoden.
    }
    throw new Error(msg);
  }
  return (await res.json()) as BelaggningData;
}
