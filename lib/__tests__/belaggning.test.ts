import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  allocationTotalHours,
  buildOccupancySeries,
  countWeekdays,
  distributeAllocation,
  eachDay,
  hoursPerWeekday,
  isWeekend,
  plannedHoursPerDay,
  rangeFor,
} from "../belaggning";
import type { HourAllocation } from "../sections";

function alloc(
  member: HourAllocation["member"],
  hours: number,
  startDate: string,
  endDate: string,
  mode: HourAllocation["mode"] = "total",
): HourAllocation {
  return {
    id: `t-${startDate}-${hours}-${mode}`,
    member,
    hours,
    mode,
    startDate,
    endDate,
    comment: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("datumhjälpare", () => {
  it("känner igen helger", () => {
    expect(isWeekend("2026-09-05")).toBe(true); // lördag
    expect(isWeekend("2026-09-06")).toBe(true); // söndag
    expect(isWeekend("2026-09-04")).toBe(false); // fredag
    expect(isWeekend("2026-09-07")).toBe(false); // måndag
  });

  it("räknar dagar och vardagar inklusive båda ändarna", () => {
    expect(eachDay("2026-09-01", "2026-09-07")).toHaveLength(7);
    expect(eachDay("2026-09-07", "2026-09-01")).toEqual([]);
    expect(countWeekdays("2026-08-31", "2026-09-06")).toBe(5); // mån–sön
    expect(countWeekdays("2026-09-05", "2026-09-06")).toBe(0); // bara helg
  });

  it("adderar dagar och månader", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonths("2026-09-04", 2)).toBe("2026-11-04");
  });
});

describe("fördelning av en allokering", () => {
  it("fördelar timmarna jämnt över vardagarna och hoppar över helger", () => {
    // Mån 31 aug – sön 13 sep: 10 vardagar.
    const a = alloc("Albin Herbst", 35, "2026-08-31", "2026-09-13");
    expect(hoursPerWeekday(a)).toBeCloseTo(3.5);
    const d = distributeAllocation(a, "2026-08-31", "2026-09-13");
    expect(d.size).toBe(10);
    expect(d.get("2026-09-05")).toBeUndefined();
    expect(d.get("2026-09-01")).toBeCloseTo(3.5);
    const total = [...d.values()].reduce((x, y) => x + y, 0);
    expect(total).toBeCloseTo(35);
  });

  it("klipper mot det efterfrågade intervallet", () => {
    const a = alloc("Albin Herbst", 35, "2026-08-31", "2026-09-13");
    const d = distributeAllocation(a, "2026-09-07", "2026-09-30");
    expect(d.size).toBe(5);
    expect(d.get("2026-09-04")).toBeUndefined();
  });

  it("faller tillbaka på kalenderdagar om intervallet saknar vardagar", () => {
    const a = alloc("Albin Herbst", 4, "2026-09-05", "2026-09-06");
    expect(hoursPerWeekday(a)).toBe(2);
    const d = distributeAllocation(a, "2026-09-01", "2026-09-30");
    expect(d.get("2026-09-05")).toBe(2);
    expect(d.get("2026-09-06")).toBe(2);
  });

  it("per vardag: samma antal timmar varje vardag, helger hoppas över", () => {
    // Mån 31 aug – sön 13 sep: 10 vardagar.
    const a = alloc("Albin Herbst", 2, "2026-08-31", "2026-09-13", "per_day");
    expect(hoursPerWeekday(a)).toBe(2);
    expect(allocationTotalHours(a)).toBe(20);
    const d = distributeAllocation(a, "2026-08-31", "2026-09-13");
    expect(d.size).toBe(10);
    expect(d.get("2026-09-01")).toBe(2);
    expect(d.get("2026-09-11")).toBe(2);
    expect(d.get("2026-09-05")).toBeUndefined();
  });

  it("per vardag över en helg planerar ingenting", () => {
    const a = alloc("Albin Herbst", 2, "2026-09-05", "2026-09-06", "per_day");
    expect(distributeAllocation(a, "2026-09-01", "2026-09-30").size).toBe(0);
    expect(allocationTotalHours(a)).toBe(0);
  });

  it("ger inget för 0 timmar", () => {
    const a = alloc("Albin Herbst", 0, "2026-09-01", "2026-09-30");
    expect(distributeAllocation(a, "2026-09-01", "2026-09-30").size).toBe(0);
  });
});

describe("summering av överlappande projekt", () => {
  it("summerar per dag utan spärr — kan överstiga 10 h", () => {
    const allocs = [
      alloc("Albin Herbst", 35, "2026-09-07", "2026-09-11"), // 7 h/dag
      alloc("Albin Herbst", 20, "2026-09-09", "2026-09-10"), // 10 h/dag
    ];
    const per = plannedHoursPerDay(allocs, "2026-09-01", "2026-09-30");
    expect(per.get("2026-09-08")).toBeCloseTo(7);
    expect(per.get("2026-09-09")).toBeCloseTo(17);
    expect(per.get("2026-09-10")).toBeCloseTo(17);
    expect(per.get("2026-09-12")).toBeUndefined();
  });
});

describe("sammanslagen tidsserie", () => {
  it("tar historik före idag och plan från idag och framåt, med källa", () => {
    const today = "2026-09-04"; // fredag
    const worked = { "2026-09-02": 7, "2026-09-03": 7 };
    const allocations = [
      alloc("Albin Herbst", 21, "2026-09-03", "2026-09-08"), // 4 vardagar → 5.25 h
      alloc("David Saupe", 99, "2026-09-04", "2026-09-04"), // annan person
    ];
    const s = buildOccupancySeries({
      person: "Albin Herbst",
      from: "2026-09-02",
      to: "2026-09-08",
      today,
      worked,
      workedSource: "stub",
      allocations,
    });
    expect(s.points.map((p) => p.date)).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ]);
    // Före idag: historik (allokeringen 3 sep ignoreras eftersom dagen är passerad).
    expect(s.points[1]).toEqual({ date: "2026-09-03", hours: 7, source: "stub" });
    // Idag och framåt: plan.
    expect(s.points[2]).toEqual({ date: "2026-09-04", hours: 5.3, source: "allocation" });
    expect(s.points[3]).toEqual({ date: "2026-09-05", hours: 0, source: "allocation" });
    expect(s.points[5]).toEqual({ date: "2026-09-07", hours: 5.3, source: "allocation" });
    // Dagar utan historik i svaret = 0.
    const s2 = buildOccupancySeries({
      person: "Albin Herbst",
      from: "2026-09-01",
      to: "2026-09-01",
      today,
      worked: {},
      workedSource: "fortnox",
      allocations: [],
    });
    expect(s2.points[0]).toEqual({ date: "2026-09-01", hours: 0, source: "fortnox" });
  });
});

describe("visningsperioder", () => {
  it("standardvyn är 31 dagar bakåt och två månader framåt", () => {
    expect(rangeFor("default", "2026-09-04", 2026)).toEqual({
      from: "2026-08-04",
      to: "2026-11-04",
    });
  });
  it("helårsvyn täcker hela året", () => {
    expect(rangeFor("year", "2026-09-04", 2026)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
});
