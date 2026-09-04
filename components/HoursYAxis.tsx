"use client";

import { useChart } from "@/components/charts/chart-context";
import { fmtHours } from "@/lib/hours";

interface Props {
  /** Antal ticks — matcha Grid:s numTicksRows så etiketterna sitter på linjerna. */
  ticks?: number;
}

/**
 * Värdeetiketter på y-axeln för vertikala staplar. bklits BarYAxis är
 * kategoriaxeln för horisontella staplar, så vertikala grafer saknar
 * annars helt siffror på skalan. Ritas i svg-koordinater via chart-
 * kontexten, med samma tick-beräkning (d3 `ticks`) som Grid.
 */
export function HoursYAxis({ ticks = 4 }: Props) {
  const { yScale } = useChart();
  const values = yScale.ticks(ticks);
  return (
    <g aria-hidden>
      {values.map((v) => (
        <text
          key={v}
          x={-8}
          y={yScale(v)}
          dy="0.32em"
          textAnchor="end"
          fontSize={11}
          fill="var(--chart-label)"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmtHours(v)}
        </text>
      ))}
    </g>
  );
}
