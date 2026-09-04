/** Viktad prognos inom reservens min-/maxintervall. */
export function expectedReserveHours(
  min: number,
  max: number,
  probability: number,
): number {
  return min + Math.min(1, Math.max(0, probability)) * (max - min);
}

/** PERT-prognos: det troliga utfallet väger fyra gånger. */
export function pertEstimate(low: number, likely: number, high: number): number {
  return (low + 4 * likely + high) / 6;
}
