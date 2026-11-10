import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Same files as Next.js: .env.local wins over .env (loadEnvFile never overwrites a set variable).
for (const name of [".env.local", ".env"]) {
  const envFile = path.join(root, name);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`Missing env vars in .env.local or .env: ${missing.join(", ")}`);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}
