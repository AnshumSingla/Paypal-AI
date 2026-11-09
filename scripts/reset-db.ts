// npm run db:reset: wipe all demo data and re-seed Maple Heights (Week 46). Stop `npm run dev` first
// when using the embedded database, since PGlite allows one process at a time.
import { existsSync } from "node:fs";
import { getDb } from "../lib/db";
import { resetDemo } from "../lib/engine/demo";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const db = await getDb();
  await resetDemo(db);
  console.log("Demo data reset.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
