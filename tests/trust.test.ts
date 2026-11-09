import { describe, expect, it } from "vitest";
import { trustScore } from "../lib/engine/trust";
import { scoreBid } from "../lib/ai/agents/sellerSide";

const now = new Date("2026-11-10T12:00:00Z").getTime();
const day = 24 * 3600 * 1000;
const ev = (score: number, weight = 1, ageDays = 1, voided = false) => ({ score, weight, voided, createdAt: new Date(now - ageDays * day) });

describe("trust score (verified events, smoothed)", () => {
  it("starts new subjects at the neutral prior", () => {
    expect(trustScore([], now)).toBe(75);
  });

  it("two perfect orders don't outrank two hundred good ones", () => {
    const newcomer = trustScore([ev(100), ev(100)], now);
    const veteran = trustScore([...Array.from({ length: 190 }, () => ev(100)), ...Array.from({ length: 10 }, () => ev(0))], now);
    expect(veteran).toBeGreaterThan(newcomer);
    expect(veteran).toBeGreaterThan(85);
  });

  it("counts recent events more than old ones", () => {
    const recentlyBad = trustScore([...Array.from({ length: 30 }, () => ev(100, 1, 300)), ...Array.from({ length: 10 }, () => ev(0, 1, 2))], now);
    const longAgoBad = trustScore([...Array.from({ length: 30 }, () => ev(100, 1, 2)), ...Array.from({ length: 10 }, () => ev(0, 1, 300))], now);
    expect(longAgoBad).toBeGreaterThan(recentlyBad);
  });

  it("a voided event (appeal upheld) no longer counts", () => {
    const events = [ev(100, 20), ev(0, 5)];
    const before = trustScore(events, now);
    const after = trustScore([events[0], { ...events[1], voided: true }], now);
    expect(after).toBeGreaterThan(before);
  });

  it("uses weight: one bad pool of forty lines hurts more than one bad line", () => {
    expect(trustScore([ev(100, 40), ev(0, 1)], now)).toBeGreaterThan(trustScore([ev(100, 1), ev(0, 40)], now));
  });
});

describe("bid score (price, trust, reachable MOQ)", () => {
  const tiers = (t1: number) => [{ minQty: 20, unitCents: t1 }];
  const bid = (t1: number, trust: number) => ({ id: "b", sellerName: "S", trust, moq: 20, maxCapacity: 100, tiers: tiers(t1), deliveryWindow: "Sat", note: null });

  it("a well-trusted supplier can beat a slightly cheaper one with a poor record", () => {
    const cheapButShaky = scoreBid(bid(340, 55), 40, 429).score;
    const trusted = scoreBid(bid(360, 94), 40, 429).score;
    expect(trusted).toBeGreaterThan(cheapButShaky);
  });

  it("a much cheaper supplier still wins when trust is equal", () => {
    expect(scoreBid(bid(330, 80), 40, 429).score).toBeGreaterThan(scoreBid(bid(390, 80), 40, 429).score);
  });
});
