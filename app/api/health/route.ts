// Render health check: the instance is healthy only if it can reach its database, so a deploy
// whose database is unreachable never takes traffic and a stuck instance gets restarted.
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { payMode } from "@/lib/paypal/gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, paypal: payMode() });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
