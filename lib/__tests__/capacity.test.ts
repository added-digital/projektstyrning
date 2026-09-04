import { describe, expect, it } from "vitest";
import { expectedReserveHours, pertEstimate } from "../capacity";

describe("kapacitetsreserver", () => {
  it("viktar intervallet mellan min och max", () => {
    expect(expectedReserveHours(1, 4, 0.7)).toBeCloseTo(3.1);
  });

  it("begränsar sannolikheten till 0–100 procent", () => {
    expect(expectedReserveHours(2, 6, -1)).toBe(2);
    expect(expectedReserveHours(2, 6, 2)).toBe(6);
  });

  it("viktar det troliga utfallet fyra gånger", () => {
    expect(pertEstimate(12, 22, 38)).toBe(23);
  });
});
