// npm run db:prepare (Render build step): create, migrate and seed the embedded database now.
// Creating a PGlite database from scratch takes more memory than the free 512 MB instance has,
// so the running server only opens the one made here.
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const db = await getDb();
  await db.execute(sql`checkpoint`); // flush to disk before exiting
  console.log("Database ready.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
