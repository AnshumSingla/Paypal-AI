import { describe, expect, it } from "vitest";
import { nextTier, PolicyError, settlePool, unitPriceAt, validateTiers } from "../lib/engine/pricing";

const tiers = [
  { minQty: 20, unitCents: 480 },
  { minQty: 40, unitCents: 440 },
  { minQty: 80, unitCents: 410 },
];
const bid = { moq: 20, maxCapacity: 100, tiers };

describe("tier pricing (Policies §2)", () => {
  it("prices by the tier reached", () => {
    expect(unitPriceAt(tiers, 19)).toBeNull();
    expect(unitPriceAt(tiers, 20)).toBe(480);
    expect(unitPriceAt(tiers, 55)).toBe(440);
    expect(unitPriceAt(tiers, 80)).toBe(410);
  });
  it("tells residents how far the next break is", () => {
    expect(nextTier(tiers, 37)).toEqual({ needed: 3, unitCents: 440 });
    expect(nextTier(tiers, 90)).toBeNull();
  });
  it("rejects invalid tier sheets", () => {
    expect(() => validateTiers(20, 100, tiers)).not.toThrow();
    expect(() => validateTiers(10, 100, tiers)).toThrow(PolicyError); // first tier ≠ MOQ
    expect(() => validateTiers(20, 100, [tiers[0], { minQty: 40, unitCents: 500 }])).toThrow(/cheaper/);
    expect(() => validateTiers(20, 30, tiers)).toThrow(/capacity/);
  });
});

describe("pool settlement (Policies §5)", () => {
  const line = (id: string, qty: number, t: number) => ({ id, qty, authorizedAt: t });

  it("fails below MOQ and releases every line", () => {
    const out = settlePool(bid, [line("a", 5, 1), line("b", 10, 2)]);
    expect(out.status).toBe("FAILED");
    expect(out.released).toEqual(["a", "b"]);
  });

  it("crossing tier 2 prices every line at tier 2", () => {
    const out = settlePool(bid, [line("a", 20, 1), line("b", 25, 2)]);
    expect(out).toMatchObject({ status: "SUCCEEDED", keptQty: 45, finalUnitCents: 440 });
  });

  it("over capacity keeps whole lines first-committed-first-served", () => {
    const out = settlePool({ ...bid, maxCapacity: 50 }, [line("late", 10, 9), line("early", 30, 1), line("mid", 15, 5)]);
    expect(out.kept).toEqual(["early", "mid"]);
    expect(out.released).toEqual(["late"]);
    expect(out.keptQty).toBe(45);
  });
});
