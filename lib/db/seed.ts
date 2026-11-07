// Demo data: the "Maple Heights" society, 40 households, 3 sellers, an operator and a grocery
// catalog with retail reference prices. Everything here is clearly demo data (sandbox only).
import { sql } from "drizzle-orm";
import type { DB } from "./index";
import * as s from "./schema";
import { newId } from "../util/ids";

export const SOCIETY_ID = "soc_maple";
export const PERSONAS = {
  resident: "usr_resident",
  captain: "usr_captain",
  seller: "usr_seller_fresh",
  operator: "usr_operator",
} as const;

type P = Omit<typeof s.product.$inferInsert, "searchText">;
export const CATALOG: P[] = [
  { id: "prd_eggs12", title: "Large white eggs", brand: null, packSize: "12 count", category: "dairy_eggs", retailRefCents: 429, perishable: true },
  { id: "prd_eggs18b", title: "Cage-free brown eggs", brand: null, packSize: "18 count", category: "dairy_eggs", retailRefCents: 649, perishable: true },
  { id: "prd_milkwhole", title: "Whole milk", brand: null, packSize: "1 gal", category: "dairy_eggs", retailRefCents: 419, perishable: true },
  { id: "prd_milk2", title: "2% reduced-fat milk", brand: null, packSize: "1 gal", category: "dairy_eggs", retailRefCents: 409, perishable: true },
  { id: "prd_basmati_ig", title: "Basmati rice", brand: "India Gate", packSize: "10 lb", category: "staples", retailRefCents: 1999 },
  { id: "prd_basmati", title: "Basmati rice", brand: null, packSize: "10 lb", category: "staples", retailRefCents: 1549 },
  { id: "prd_jasmine", title: "Jasmine rice", brand: null, packSize: "20 lb", category: "staples", retailRefCents: 2499 },
  { id: "prd_atta", title: "Whole wheat atta flour", brand: "Aashirvaad", packSize: "20 lb", category: "staples", retailRefCents: 1799 },
  { id: "prd_apflour", title: "All-purpose flour", brand: null, packSize: "5 lb", category: "staples", retailRefCents: 449 },
  { id: "prd_canola", title: "Canola oil", brand: null, packSize: "48 oz", category: "staples", retailRefCents: 699 },
  { id: "prd_olive", title: "Extra virgin olive oil", brand: null, packSize: "1 L", category: "staples", retailRefCents: 1299 },
  { id: "prd_sugar", title: "Granulated sugar", brand: null, packSize: "4 lb", category: "staples", retailRefCents: 399 },
  { id: "prd_toordal", title: "Toor dal (split pigeon peas)", brand: null, packSize: "4 lb", category: "staples", retailRefCents: 999 },
  { id: "prd_chickpeas", title: "Canned chickpeas", brand: null, packSize: "6 x 15 oz", category: "staples", retailRefCents: 749 },
  { id: "prd_oats", title: "Old-fashioned rolled oats", brand: null, packSize: "42 oz", category: "staples", retailRefCents: 649 },
  { id: "prd_pb", title: "Creamy peanut butter", brand: null, packSize: "40 oz", category: "staples", retailRefCents: 799 },
  { id: "prd_coffee", title: "Ground coffee, medium roast", brand: null, packSize: "30.5 oz", category: "beverages", retailRefCents: 1399 },
  { id: "prd_onions", title: "Yellow onions", brand: null, packSize: "3 lb bag", category: "produce", retailRefCents: 349, perishable: true },
  { id: "prd_potatoes", title: "Russet potatoes", brand: null, packSize: "5 lb bag", category: "produce", retailRefCents: 499, perishable: true },
  { id: "prd_dishsoap", title: "Dish soap", brand: null, packSize: "38 oz", category: "household", retailRefCents: 499 },
  { id: "prd_laundry", title: "Laundry detergent pods", brand: null, packSize: "42 count", category: "household", retailRefCents: 1399 },
  { id: "prd_papertowel", title: "Paper towels", brand: null, packSize: "6 rolls", category: "household", retailRefCents: 1199 },
  { id: "prd_tp", title: "Toilet paper", brand: null, packSize: "12 rolls", category: "household", retailRefCents: 1499 },
  { id: "prd_trashbags", title: "Kitchen trash bags, 13 gal", brand: null, packSize: "45 count", category: "household", retailRefCents: 1149 },
  { id: "prd_toothpaste", title: "Fluoride toothpaste", brand: null, packSize: "3 x 4 oz", category: "personal_care", retailRefCents: 899 },
  { id: "prd_beer", title: "Lager beer", brand: null, packSize: "12 x 12 oz", category: "beverages", retailRefCents: 1699, restricted: true },
];

export const searchTextFor = (p: Pick<P, "title" | "brand" | "packSize" | "category">) =>
  [p.title, p.brand ?? "", p.packSize, p.category].join(" ").toLowerCase();

/** Small deterministic PRNG so the demo looks the same every reset. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weekDeadlines(now = new Date()): s.CycleDeadlines {
  const day = 24 * 3600 * 1000;
  const iso = (d: number) => new Date(now.getTime() + d).toISOString();
  return { collect: iso(1 * day), bid: iso(2 * day), cutoff: iso(3 * day), dropStart: iso(5 * day), dropEnd: iso(5 * day + 3 * 3600 * 1000) };
}

const UNIT_LABELS = (() => {
  const labels: string[] = [];
  for (const tower of ["A", "B"]) for (let floor = 2; floor <= 12; floor += 1) for (const unit of ["01", "04"]) labels.push(`${tower}-${floor}${unit}`);
  return labels.slice(0, 40);
})();

// Weekly demand profile used for seeded and simulated needs: [productId, probability, maxQty]
export const DEMAND_PROFILE: [string, number, number][] = [
  ["prd_eggs12", 0.7, 3],
  ["prd_milkwhole", 0.55, 2],
  ["prd_basmati", 0.35, 1],
  ["prd_atta", 0.3, 1],
  ["prd_canola", 0.4, 2],
  ["prd_toordal", 0.25, 2],
  ["prd_onions", 0.45, 2],
  ["prd_dishsoap", 0.3, 1],
  ["prd_laundry", 0.3, 1],
  ["prd_tp", 0.35, 1],
  ["prd_coffee", 0.25, 1],
];

export async function ensureSeeded(db: DB) {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(s.society);
  if (existing[0].n > 0) return;
  await seed(db);
}

export async function seed(db: DB) {
  await db.insert(s.product).values(CATALOG.map((p) => ({ ...p, searchText: searchTextFor(p) })));
  await db.insert(s.society).values({ id: SOCIETY_ID, name: "Maple Heights", dropPoint: "Lobby package room, Tower A" });

  const households = UNIT_LABELS.map((unitLabel, i) => ({ id: `hh_${i + 1}`, societyId: SOCIETY_ID, unitLabel }));
  await db.insert(s.household).values(households);

  await db.insert(s.appUser).values([
    { id: PERSONAS.resident, name: `Priya (${UNIT_LABELS[30]})`, email: "resident@poolcart.demo", role: "resident", householdId: "hh_31", societyId: SOCIETY_ID, isPersona: true },
    { id: PERSONAS.captain, name: `Sam (Captain, ${UNIT_LABELS[11]})`, email: "captain@poolcart.demo", role: "captain", householdId: "hh_12", societyId: SOCIETY_ID, isPersona: true },
    { id: PERSONAS.seller, name: "FreshFarm Wholesale", email: "orders@freshfarm.demo", role: "seller", isPersona: true },
    { id: PERSONAS.operator, name: "PoolCart Ops", email: "ops@poolcart.demo", role: "operator", isPersona: true },
    { id: "usr_seller_valley", name: "Valley Staples Co.", email: "bids@valleystaples.demo", role: "seller" },
    { id: "usr_seller_corner", name: "Corner Grocer Plus", email: "hello@cornergrocer.demo", role: "seller" },
    { id: "usr_seller_sunrise", name: "Sunrise Bulk Foods", email: "team@sunrisebulk.demo", role: "seller" },
  ]);

  await db.insert(s.seller).values([
    { id: "sel_fresh", userId: PERSONAS.seller, businessName: "FreshFarm Wholesale", payoutEmail: process.env.PAYPAL_SANDBOX_PERSONAL_EMAIL || "freshfarm-payouts@poolcart.demo", status: "approved", licenseRef: "CA-FOOD-48213", rating: 47, fillRatePct: 98, plan: "starter" },
    { id: "sel_valley", userId: "usr_seller_valley", businessName: "Valley Staples Co.", payoutEmail: "valley-payouts@poolcart.demo", status: "approved", licenseRef: "CA-FOOD-11907", rating: 44, fillRatePct: 93, plan: "starter" },
    { id: "sel_corner", userId: "usr_seller_corner", businessName: "Corner Grocer Plus", payoutEmail: "corner-payouts@poolcart.demo", status: "approved", licenseRef: "CA-FOOD-20554", rating: 41, fillRatePct: 88, plan: "starter" },
    { id: "sel_sunrise", userId: "usr_seller_sunrise", businessName: "Sunrise Bulk Foods", payoutEmail: "sunrise-payouts@poolcart.demo", status: "pending", licenseRef: "CA-FOOD-31876", rating: 45, fillRatePct: 90, plan: "starter" },
  ]);

  const cycleId = "cyc_w46";
  await db.insert(s.cycle).values({ id: cycleId, societyId: SOCIETY_ID, weekLabel: "Week 46", phase: "COLLECT", deadlines: weekDeadlines() });

  // 28 neighbours already added their needs this week (the presenter's household, hh_31, has not).
  const rand = rng(46);
  const needs: (typeof s.need.$inferInsert)[] = [];
  for (const hh of households.slice(0, 28)) {
    if (hh.id === "hh_31") continue;
    for (const [productId, p, maxQty] of DEMAND_PROFILE) {
      if (rand() < p) {
        const qty = 1 + Math.floor(rand() * maxQty);
        const prod = CATALOG.find((c) => c.id === productId)!;
        needs.push({ id: newId("need"), cycleId, householdId: hh.id, rawText: `${qty} x ${prod.title.toLowerCase()}`, productId, qty, brandFlexible: rand() < 0.6, source: "simulated" });
      }
    }
  }
  await db.insert(s.need).values(needs);
  await db.insert(s.activity).values({ id: newId("act"), cycleId, actor: "system", kind: "system", message: `Week 46 opened for Maple Heights; ${new Set(needs.map((n) => n.householdId)).size} households have added needs.` });
}
