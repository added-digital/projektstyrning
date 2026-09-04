"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { Grid } from "@/components/charts/grid";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { HoursYAxis } from "@/components/HoursYAxis";
import { fmtHours, type Period, type Pivot } from "@/lib/hours";

interface Props {
  pivot: Pivot;
  period: Period;
}

/**
 * Färg följer personen, inte rangordningen: slot = index i teamets ordning
 * (samma ordning som lib/sections.ts → workers.sort). Okopplade
 * Fortnox-användare får alltid neutralt grått — de är "okänt", inte en
 * sjätte kollega.
 */
function seriesColor(name: string, index: number): string {
  if (name.startsWith("Okopplad")) return "var(--chart-foreground-muted)";
  return `var(--chart-${(index % 5) + 1})`;
}

/**
 * Staplad stapel per period, ett segment per medarbetare. Legend är alltid
 * med (≥ 2 serier), tooltip per stapel, och en tabellvy för den som hellre
 * läser siffror — identiteten hänger aldrig på färg ensam.
 *
 * Staplarna ritas statiskt (animate=false): bklits grow-animation (motion
 * + transform-box: fill-box) lämnade rects på 0 resp. dubbel höjd i vår
 * miljö, och statiska staplar är ändå rätt beteende för reduced motion.
 */
export function HoursChart({ pivot, period }: Props) {
  const [showTable, setShowTable] = useState(false);

  const colors = useMemo(
    () => new Map(pivot.series.map((s, i) => [s, seriesColor(s, i)])),
    [pivot.series],
  );

  const data = useMemo(
    () =>
      pivot.rows.map((r) => {
        const row: Record<string, unknown> = { label: r.label, total: r.total };
        for (const s of pivot.series) row[s] = r.byWorker[s] ?? 0;
        return row;
      }),
    [pivot],
  );

  const maxLabels = period === "week" ? 12 : period === "month" ? 12 : 6;

  return (
    <div className="mt-4">
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px]" aria-label="Serier">
        {pivot.series.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: colors.get(s) }}
            />
            <span className="text-muted-foreground">{s}</span>
          </li>
        ))}
      </ul>

      <BarChart
        data={data}
        xDataKey="label"
        stacked
        stackGap={2}
        barGap={0.35}
        aspectRatio="3 / 1"
        animationDuration={0}
        margin={{ top: 16, right: 12, bottom: 32, left: 40 }}
        className="mt-3"
      >
        <Grid horizontal vertical={false} numTicksRows={4} />
        <HoursYAxis ticks={4} />
        {pivot.series.map((s) => (
          <Bar
            key={s}
            dataKey={s}
            fill={colors.get(s)}
            lineCap={4}
            animate={false}
            minBarHeight={0}
          />
        ))}
        <BarXAxis maxLabels={maxLabels} showAllLabels={pivot.rows.length <= maxLabels} />
        <ChartTooltip
          showDatePill={false}
          showDots={false}
          rows={(point) =>
            [
              ...pivot.series
                .filter((s) => Number(point[s] ?? 0) > 0)
                .map((s) => ({
                  color: colors.get(s) ?? "var(--chart-foreground)",
                  label: s,
                  value: `${fmtHours(Number(point[s]))} h`,
                })),
              {
                color: "transparent",
                label: `Totalt ${String(point.label ?? "")}`,
                value: `${fmtHours(Number(point.total ?? 0))} h`,
              },
            ]
          }
        />
      </BarChart>

      <div className="mt-2">
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Dölj tabell" : "Visa som tabell"}
        </button>
      </div>

      {showTable && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px] tabular-nums">
            <caption className="sr-only">Rapporterade timmar per period och medarbetare</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-medium">Period</th>
                {pivot.series.map((s) => (
                  <th key={s} scope="col" className="py-1.5 pr-3 text-right font-medium">
                    {s}
                  </th>
                ))}
                <th scope="col" className="py-1.5 text-right font-medium">Totalt</th>
              </tr>
            </thead>
            <tbody>
              {pivot.rows.map((r) => (
                <tr key={r.period_start} className="border-t border-border">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {r.label}
                  </th>
                  {pivot.series.map((s) => (
                    <td key={s} className="py-1.5 pr-3 text-right text-muted-foreground">
                      {r.byWorker[s] ? fmtHours(r.byWorker[s]) : "–"}
                    </td>
                  ))}
                  <td className="py-1.5 text-right">{fmtHours(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
