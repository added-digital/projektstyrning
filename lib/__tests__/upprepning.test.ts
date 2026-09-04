import { describe, expect, it } from "vitest";
import {
  allocationTotalHours,
  distributeAllocation,
  nextWeekday,
  recurrenceDates,
} from "../belaggning";
import type { HourAllocation } from "../sections";

function rep(repeat: "week" | "month", startDate: string, endDate: string, hours = 2): HourAllocation {
  return {
    id: "r1",
    member: "Albin Herbst",
    hours,
    mode: "per_day",
    repeat,
    startDate,
    endDate,
    comment: "",
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

describe("nextWeekday", () => {
  it("flyttar helg till måndag, lämnar vardagar", () => {
    expect(nextWeekday("2026-09-05")).toBe("2026-09-07"); // lör
    expect(nextWeekday("2026-09-06")).toBe("2026-09-07"); // sön
    expect(nextWeekday("2026-09-07")).toBe("2026-09-07"); // mån
  });
});

describe("upprepning varje vecka", () => {
  it("infaller var sjunde dag från startdatum, inom perioden", () => {
    // 2026-09-08 är en tisdag
    expect(recurrenceDates(rep("week", "2026-09-08", "2026-09-30"), "2026-01-01", "2026-12-31")).toEqual([
      "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29",
    ]);
  });

  it("klipper mot det efterfrågade fönstret", () => {
    expect(recurrenceDates(rep("week", "2026-09-08", "2026-12-31"), "2026-09-14", "2026-09-25")).toEqual([
      "2026-09-15", "2026-09-22",
    ]);
  });

  it("fördelar timmarna per tillfälle och summerar totalen", () => {
    const a = rep("week", "2026-09-08", "2026-09-30", 3);
    const m = distributeAllocation(a, "2026-09-01", "2026-09-30");
    expect([...m.entries()]).toEqual([
      ["2026-09-08", 3], ["2026-09-15", 3], ["2026-09-22", 3], ["2026-09-29", 3],
    ]);
    expect(allocationTotalHours(a)).toBe(12);
  });
});

describe("upprepning varje månad", () => {
  it("samma dag i månaden, helg flyttas till nästa vardag", () => {
    // 2026-09-05 är lördag → 7:e; 2026-10-05 måndag; 2026-11-05 torsdag; 2026-12-05 lör → 7:e
    expect(recurrenceDates(rep("month", "2026-09-05", "2026-12-31"), "2026-01-01", "2026-12-31")).toEqual([
      "2026-09-07", "2026-10-05", "2026-11-05", "2026-12-07",
    ]);
  });

  it("31:a i kort månad blir månadens sista dag", () => {
    // 2026-10-31 lör → mån 2 nov; nov saknar 31 → 30 nov (mån); dec 31 (tor)
    expect(recurrenceDates(rep("month", "2026-10-31", "2026-12-31"), "2026-01-01", "2026-12-31")).toEqual([
      "2026-11-02", "2026-11-30", "2026-12-31",
    ]);
  });
});
