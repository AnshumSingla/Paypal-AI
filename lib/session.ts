// Demo auth: a signed-less persona cookie (DEMO_MODE). Each persona is a seeded user; judges switch
// roles in one click. Production would use real sign-in; nothing here grants payment access.
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import * as s from "./db/schema";

export const SESSION_COOKIE = "pc_user";

export async function getSession() {
  const db = await getDb();
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return { db, user: null, household: null, seller: null } as const;
  const [user] = await db.select().from(s.appUser).where(eq(s.appUser.id, id));
  if (!user) return { db, user: null, household: null, seller: null } as const;
  const [household] = user.householdId ? await db.select().from(s.household).where(eq(s.household.id, user.householdId)) : [null];
  const [seller] = user.role === "seller" ? await db.select().from(s.seller).where(eq(s.seller.userId, user.id)) : [null];
  return { db, user, household: household ?? null, seller: seller ?? null } as const;
}

export const homeFor = (role: string) => ({ resident: "/resident", captain: "/captain", seller: "/seller", operator: "/ops" })[role] ?? "/";
