// Database access. DATABASE_URL set → real Postgres (Render). Unset → embedded PGlite (real Postgres
// compiled to WASM) stored in ./.data, so `npm run dev` works with no Docker or setup at all.
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
// Both drivers expose the same query builder; transactions receive the same API.
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const MIGRATIONS = path.join(process.cwd(), "lib", "db", "migrations");

type Holder = { db?: Promise<DB> };
const g = globalThis as unknown as { __poolcartDb?: Holder };
g.__poolcartDb ??= {};

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url && !url.includes("localhost:5432/poolcart")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, ssl: url.includes("render.com") ? { rejectUnauthorized: false } : undefined });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR === "memory" ? undefined : (process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  if (dataDir) (await import("node:fs")).mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as DB;
}

/** Shared connection; migrates on first use and seeds the demo society if the DB is empty. */
export function getDb(): Promise<DB> {
  g.__poolcartDb!.db ??= connect()
    .then(async (db) => {
      const { ensureSeeded } = await import("./seed");
      await ensureSeeded(db);
      const { refreshStaleDemo } = await import("../engine/demo");
      await refreshStaleDemo(db);
      await restoreMockPayPal(db);
      return db;
    })
    .catch((e) => {
      g.__poolcartDb!.db = undefined; // don't cache a failed connection
      throw e;
    });
  return g.__poolcartDb!.db;
}

/** In mock PayPal mode, holds live in memory while the DB persists; rebuild them after a restart. */
export async function restoreMockPayPal(db: DB) {
  const { payMode, mockRestore } = await import("../paypal/gateway");
  if (payMode() !== "mock") return;
  const { sql } = await import("drizzle-orm");
  const p = schema.payment;
  const rows = await db
    .select({
      paypalOrderId: p.paypalOrderId,
      paypalAuthorizationId: p.paypalAuthorizationId,
      paypalCaptureId: p.paypalCaptureId,
      authorizedCents: p.authorizedCents,
      capturedCents: p.capturedCents,
      status: p.status,
      refundedCents: sql<number>`coalesce((select sum(${schema.refund.amountCents}) from ${schema.refund} where ${schema.refund.paymentId} = ${p.id}), 0)::int`,
    })
    .from(p);
  mockRestore(rows);
}

/** For tests: a fresh in-memory database with the schema applied (not seeded). */
export async function memoryDb(): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as DB;
}

export { schema };
