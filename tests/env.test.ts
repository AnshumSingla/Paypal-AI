import { describe, expect, it } from "vitest";
import { trimEnv } from "../lib/env";

describe("trimEnv", () => {
  it("strips the trailing newline a pasted key carries", () => {
    process.env.TEST_PASTED_KEY = "AbC123\n";
    trimEnv();
    expect(process.env.TEST_PASTED_KEY).toBe("AbC123");
    delete process.env.TEST_PASTED_KEY;
  });
});
