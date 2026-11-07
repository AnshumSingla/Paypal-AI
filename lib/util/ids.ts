import { randomBytes } from "node:crypto";

/** Short, prefixed, URL-safe ids: newId("bsk") → "bsk_8f3k2m9q1x". */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 10).toLowerCase()}`;
}
