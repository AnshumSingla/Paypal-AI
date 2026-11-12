// npm run db:prepare (Render build step): create, migrate and seed the embedded database now.
// With DATABASE_URL (the hosted demo's Neon Postgres) this seeds it before the first visitor arrives;
// without it, it prepares the embedded PGlite database in ./.data.
import { trimEnv } from "../lib/env";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  trimEnv();
  const db = await getDb();
  if (!process.env.DATABASE_URL) await db.execute(sql`checkpoint`); // flush PGlite to disk before exiting
  console.log("Database ready.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
