import { describe, expect, it } from "vitest";
import { settleAll } from "../lib/util/pool";

describe("settleAll", () => {
  it("keeps input order, caps calls in flight, and reports failures without throwing", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await settleAll([5, 1, 4, 2, 3, 0], 2, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, n * 3));
      inFlight--;
      if (n === 4) throw new Error("declined");
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([50, 10, "x", 20, 30, 0]);
  });
});
