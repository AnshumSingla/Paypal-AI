// Channel3 retail prices: savings are never measured against an outlier or a different product.
import { describe, expect, it } from "vitest";
import { pickRetailCents } from "../lib/engine/retail";
import { sameProduct } from "../lib/channel3";

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

describe("sameProduct", () => {
  it("accepts the same product named differently", () => {
    expect(sameProduct("Toilet paper", "Scott 1000 Toilet Paper, 1000 Sheets per Roll")).toBe(true);
    expect(sameProduct("Kitchen trash bags, 13 gal", "Glad ForceFlex 13-Gallon Tall Kitchen Trash Bags")).toBe(true);
  });
  it("rejects things that only share a word, which Channel3 really returned", () => {
    expect(sameProduct("Jasmine rice", "Brentwood 4 Cup White Rice Cooker")).toBe(false);
    expect(sameProduct("Cage-free brown eggs", "Rubber Nest Eggs, 2 count, Brown")).toBe(false);
    expect(sameProduct("Russet potatoes", "Gardener's Guide to Growing Potatoes")).toBe(false);
    expect(sameProduct("Ground coffee, medium roast", "Ground Coffee Scoop")).toBe(false);
  });
});
