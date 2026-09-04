import { NextResponse } from "next/server";
import { listCustomers, readCustomer } from "@/lib/storage";
import {
  teamMembers,
  type HourAllocation,
  type TeamMember,
} from "@/lib/sections";
import {
  buildOccupancySeries,
  eachDay,
  parseISO,
  rangeFor,
  todayISO,
  type OccupancySeries,
} from "@/lib/belaggning";
import { getHistoricalSource } from "@/lib/belaggningHistorik";

export const dynamic = "force-dynamic";

/** Max antal dagar per anrop — skyddar mot orimliga intervall. */
const MAX_DAYS = 800;

export interface BelaggningResponse {
  from: string;
  to: string;
  today: string;
  series: OccupancySeries[];
}

/** Projekt vars planerade tid räknas — samma regel som tidslinjen. */
function countsTowardLoad(status: string | undefined): boolean {
  const s = status ?? "active";
  return s === "active" || s === "lead";
}

export interface CollectDiagnostics {
  customers: { slug: string; updatedAt: string; projects: number; allocations: number; skipped: number; error?: string }[];
}

/**
 * Samlar alla timallokeringar från alla kunder och räknade projekt.
 * Läsfel per kund loggas och rapporteras i diagnostiken i stället för att
 * tyst försvinna — en tyst miss här ger fel beläggning för alla.
 */
async function collectHourAllocations(diag?: CollectDiagnostics): Promise<HourAllocation[]> {
  const customers = await listCustomers();
  const all: HourAllocation[] = [];
  for (const c of customers) {
    const row = { slug: c.slug, updatedAt: c.updatedAt, projects: 0, allocations: 0, skipped: 0 } as CollectDiagnostics["customers"][number];
    try {
      const data = await readCustomer(c.slug);
      row.projects = data.projects.length;
      for (const p of data.projects) {
        if (!countsTowardLoad(p.status)) { row.skipped++; continue; }
        all.push(...(p.hourAllocations ?? []));
        row.allocations += (p.hourAllocations ?? []).length;
      }
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
      console.error("[belaggning] kunde inte läsa kund", c.slug, row.error);
    }
    diag?.customers.push(row);
  }
  return all;
}

/**
 * GET /api/belaggning?person_id=&from=&to=
 *
 * Slår ihop historik (stub, senare Fortnox) och planerad tid (allokeringar)
 * till EN tidsserie per person. Utelämnas `person_id` returneras alla i
 * teamet. Utelämnas `from`/`to` används standardvyn: 31 dagar bakåt och två
 * månader framåt.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = todayISO();
  const defaults = rangeFor("default", today, Number(today.slice(0, 4)));
  const from = url.searchParams.get("from") || defaults.from;
  const to = url.searchParams.get("to") || defaults.to;
  const personParam = url.searchParams.get("person_id") ?? "";

  if (!parseISO(from) || !parseISO(to)) {
    return NextResponse.json(
      { error: "from/to måste vara YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (to < from) {
    return NextResponse.json({ error: "to ligger före from" }, { status: 400 });
  }
  if (eachDay(from, to).length > MAX_DAYS) {
    return NextResponse.json(
      { error: `Intervallet får vara högst ${MAX_DAYS} dagar` },
      { status: 400 },
    );
  }

  let persons: readonly TeamMember[] = teamMembers;
  if (personParam) {
    if (!(teamMembers as readonly string[]).includes(personParam)) {
      return NextResponse.json({ error: "Okänd person_id" }, { status: 400 });
    }
    persons = [personParam as TeamMember];
  }

  const historical = getHistoricalSource();
  const diag: CollectDiagnostics = { customers: [] };
  const allocations = await collectHourAllocations(diag);

  const series = await Promise.all(
    persons.map(async (person) => {
      // Historik behövs bara för dagar före idag.
      const worked =
        from < today
          ? await historical.getWorkedHours(
              person,
              from,
              to < today ? to : today,
            )
          : {};
      return buildOccupancySeries({
        person,
        from,
        to,
        today,
        worked,
        workedSource: historical.id,
        allocations,
      });
    }),
  );

  const body: BelaggningResponse & { diag?: CollectDiagnostics & { env: Record<string, string | undefined> } } = { from, to, today, series };
  if (url.searchParams.get("debug") === "1") {
    body.diag = {
      ...diag,
      env: {
        region: process.env.VERCEL_REGION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
        node: process.version,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        supabaseHost: (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host; } catch { return undefined; } })(),
      },
    };
  }
  return NextResponse.json(body);
}
