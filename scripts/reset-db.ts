// npm run db:reset: wipe all demo data and re-seed Maple Heights (Week 46). Stop `npm run dev` first
// when using the embedded database, since PGlite allows one process at a time.
import { getDb } from "../lib/db";
import { resetDemo } from "../lib/engine/demo";

process.loadEnvFile?.(".env.local");
const db = await getDb();
await resetDemo(db);
console.log("Demo data reset.");
process.exit(0);
