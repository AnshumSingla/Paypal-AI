import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`Missing env vars in .env.local: ${missing.join(", ")}`);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}
