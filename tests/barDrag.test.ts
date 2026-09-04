import { describe, expect, it } from "vitest";
import { shiftCols } from "../lib/useBarDrag";

describe("shiftCols", () => {
  const r = { start: 10, end: 14 };

  it("flyttar hela stapeln med bevarad längd", () => {
    expect(shiftCols(r, "move", 3, 100)).toEqual({ start: 13, end: 17 });
    expect(shiftCols(r, "move", -3, 100)).toEqual({ start: 7, end: 11 });
  });

  it("klipper flytt mot rutnätets kanter utan att ändra längd", () => {
    expect(shiftCols(r, "move", -20, 100)).toEqual({ start: 0, end: 4 });
    expect(shiftCols(r, "move", 200, 100)).toEqual({ start: 96, end: 100 });
  });

  it("resize-left ändrar bara start och kan inte passera slut", () => {
    expect(shiftCols(r, "resize-left", 2, 100)).toEqual({ start: 12, end: 14 });
    expect(shiftCols(r, "resize-left", 10, 100)).toEqual({ start: 14, end: 14 });
    expect(shiftCols(r, "resize-left", -20, 100)).toEqual({ start: 0, end: 14 });
  });

  it("resize-right ändrar bara slut och kan inte passera start", () => {
    expect(shiftCols(r, "resize-right", 4, 100)).toEqual({ start: 10, end: 18 });
    expect(shiftCols(r, "resize-right", -10, 100)).toEqual({ start: 10, end: 10 });
    expect(shiftCols(r, "resize-right", 200, 100)).toEqual({ start: 10, end: 100 });
  });

  it("delta 0 ger oförändrat intervall", () => {
    expect(shiftCols(r, "move", 0, 100)).toEqual(r);
  });
});
