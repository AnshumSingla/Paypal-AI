// Channel3 retail prices: savings are never measured against an outlier or a different product.
import { describe, expect, it } from "vitest";
import { pickRetailCents } from "../lib/engine/retail";

describe("pickRetailCents", () => {
  it("takes the lower median so one expensive listing can't inflate savings", () => {
    expect(pickRetailCents(429, [399, 449, 899])).toBe(449);
    expect(pickRetailCents(429, [399, 449, 459, 899])).toBe(449);
  });
  it("ignores missing prices", () => {
    expect(pickRetailCents(429, [null, 419, null])).toBe(419);
    expect(pickRetailCents(429, [null])).toBeNull();
  });
  it("keeps the current price when Channel3 found a different pack size", () => {
    expect(pickRetailCents(1999, [599, 649])).toBeNull(); // a 2 lb bag, not 10 lb
    expect(pickRetailCents(429, [1299, 1399])).toBeNull(); // a case of eggs
  });
});
