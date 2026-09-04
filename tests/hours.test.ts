import { describe, expect, it } from "vitest";
import {
  defaultRange,
  isoWeek,
  periodLabel,
  pivotBuckets,
  startOfIsoWeek,
} from "../lib/hours";

describe("ISO-veckor", () => {
  it("startOfIsoWeek ger måndag, även för söndag", () => {
    expect(startOfIsoWeek(new Date("2026-09-06T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-08-31"); // sön
    expect(startOfIsoWeek(new Date("2026-08-31T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-08-31"); // mån
  });

  it("isoWeek stämmer runt årsskiftet", () => {
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(isoWeek(new Date("2025-12-29T00:00:00Z"))).toBe(1); // mån i v1 2026
    expect(isoWeek(new Date("2026-08-31T00:00:00Z"))).toBe(36);
  });
});

describe("defaultRange", () => {
  const today = new Date("2026-09-04T10:00:00Z"); // fredag v36
  it("week = 12 veckor bakåt från innevarande måndag", () => {
    expect(defaultRange("week", today)).toEqual({ from: "2026-06-15", to: "2026-09-04" });
  });
  it("month = innevarande år", () => {
    expect(defaultRange("month", today)).toEqual({ from: "2026-01-01", to: "2026-09-04" });
  });
  it("year = från 2026", () => {
    expect(defaultRange("year", today)).toEqual({ from: "2026-01-01", to: "2026-09-04" });
  });
});

describe("periodLabel", () => {
  it("formaterar per period", () => {
    expect(periodLabel("week", "2026-08-31")).toBe("v36");
    expect(periodLabel("month", "2026-09-01")).toBe("sep 2026");
    expect(periodLabel("year", "2026-01-01")).toBe("2026");
  });
});

describe("pivotBuckets", () => {
  const order = ["Per Albin Wilhelmsson", "David Saupe", "Albin Herbst"];
  const buckets = [
    { period_start: "2026-09-01", worker_id: "b", worker_name: "Albin Herbst", hours: 6.5 },
    { period_start: "2026-08-01", worker_id: "b", worker_name: "Albin Herbst", hours: 8 },
    { period_start: "2026-09-01", worker_id: null, worker_name: "Okopplad (t-unknown)", hours: 4 },
    { period_start: "2026-09-01", worker_id: "a", worker_name: "David Saupe", hours: 10 },
  ];

  it("sorterar perioder kronologiskt och summerar totaler", () => {
    const { rows } = pivotBuckets(buckets, "month", order);
    expect(rows.map((r) => r.label)).toEqual(["aug 2026", "sep 2026"]);
    expect(rows[0].total).toBe(8);
    expect(rows[1].total).toBe(20.5);
    expect(rows[1].byWorker).toEqual({
      "Albin Herbst": 6.5,
      "Okopplad (t-unknown)": 4,
      "David Saupe": 10,
    });
  });

  it("serier följer teamets ordning, okopplade sist, frånvarande utelämnas", () => {
    const { series } = pivotBuckets(buckets, "month", order);
    expect(series).toEqual(["David Saupe", "Albin Herbst", "Okopplad (t-unknown)"]);
  });

  it("färgslot följer personen: färre serier ändrar inte ordningen", () => {
    const onlyAlbin = buckets.filter((b) => b.worker_name === "Albin Herbst");
    expect(pivotBuckets(onlyAlbin, "month", order).series).toEqual(["Albin Herbst"]);
  });
});
