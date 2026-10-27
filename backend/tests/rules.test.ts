/**
 * Unit rules: date-condition derivation including exact day boundaries
 * (day before, maturity day itself, day after) and the sample window edge.
 */
import { describe, expect, it } from "vitest";
import { deriveDateCondition } from "../src/rules/dateCondition.js";
import { addDays, diffInDays } from "../src/utils/dates.js";

describe("deriveDateCondition", () => {
  const window = 30;

  it("classifies the exact maturity day as approaching (not yet matured)", () => {
    expect(deriveDateCondition("2026-06-01", "2026-06-01", window)).toBe("approaching_maturity");
  });

  it("classifies the day AFTER maturity as matured", () => {
    expect(deriveDateCondition("2026-06-02", "2026-06-01", window)).toBe("matured");
  });

  it("classifies the day BEFORE maturity (inside window) as approaching", () => {
    expect(deriveDateCondition("2026-05-31", "2026-06-01", window)).toBe("approaching_maturity");
  });

  it("starts approaching exactly at the window edge (maturity = today + 30)", () => {
    expect(deriveDateCondition("2026-06-01", "2026-07-01", window)).toBe("approaching_maturity");
  });

  it("stays current one day beyond the window edge", () => {
    expect(deriveDateCondition("2026-06-01", "2026-07-02", window)).toBe("current");
  });

  it("handles month and year rollovers", () => {
    expect(deriveDateCondition("2026-12-31", "2027-01-01", window)).toBe("approaching_maturity");
    expect(deriveDateCondition("2027-01-01", "2026-12-31", window)).toBe("matured");
  });

  it("ignores far-future maturity dates", () => {
    expect(deriveDateCondition("2026-01-01", "2027-12-01", window)).toBe("current");
  });
});

describe("local date arithmetic", () => {
  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("diffInDays is symmetric and exact", () => {
    expect(diffInDays("2026-03-01", "2026-03-15")).toBe(14);
    expect(diffInDays("2026-03-15", "2026-03-01")).toBe(-14);
    expect(diffInDays("2026-02-28", "2026-03-31")).toBe(31);
  });
});
