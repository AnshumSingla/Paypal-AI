// PoolCart data model (docs/02-ARCHITECTURE.md §5). All money is integer cents, USD.
import { pgTable, text, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type Tier = { minQty: number; unitCents: number };
export type CycleDeadlines = { collect: string; bid: string; cutoff: string; dropStart: string; dropEnd: string };

export const society = pgTable("society", {
  id: id(),
  name: text("name").notNull(),
  dropPoint: text("drop_point").notNull(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  autoSelectBids: boolean("auto_select_bids").notNull().default(true),
  maxQtyPerLine: integer("max_qty_per_line").notNull().default(10),
  createdAt: createdAt(),
});

export const household = pgTable("household", {
  id: id(),
  societyId: text("society_id").notNull().references(() => society.id),
  unitLabel: text("unit_label").notNull(),
  optInNudges: boolean("opt_in_nudges").notNull().default(true),
});

export const appUser = pgTable("app_user", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["resident", "captain", "seller", "operator"] }).notNull(),
  householdId: text("household_id").references(() => household.id),
  societyId: text("society_id").references(() => society.id),
  isPersona: boolean("is_persona").notNull().default(false),
});

export const seller = pgTable("seller", {
  id: id(),
  userId: text("user_id").notNull().references(() => appUser.id),
  businessName: text("business_name").notNull(),
  payoutEmail: text("payout_email").notNull(),
  status: text("status", { enum: ["pending", "approved", "suspended"] }).notNull().default("pending"),
  licenseRef: text("license_ref"),
  rating: integer("rating_x10").notNull().default(45), // 4.5 stars stored as 45
  fillRatePct: integer("fill_rate_pct").notNull().default(95),
  strikes: integer("strikes").notNull().default(0),
  plan: text("plan", { enum: ["starter", "pro", "partner"] }).notNull().default("starter"),
  paypalSubscriptionId: text("paypal_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  balanceCents: integer("balance_cents").notNull().default(0), // negative = owed to platform (Policies §8.5)
  createdAt: createdAt(),
});

export const product = pgTable("product", {
  id: id(),
  title: text("title").notNull(),
  brand: text("brand"), // null = generic / any brand
  packSize: text("pack_size").notNull(),
  category: text("category").notNull(),
  retailRefCents: integer("retail_ref_cents").notNull(),
  retailSource: text("retail_source").notNull().default("seed"), // "channel3" | "seed" | "operator"
  channel3Id: text("channel3_id"),
  imageUrl: text("image_url"),
  perishable: boolean("perishable").notNull().default(false),
  restricted: boolean("restricted").notNull().default(false),
  searchText: text("search_text").notNull(),
});

export const cycle = pgTable("cycle", {
  id: id(),
  societyId: text("society_id").notNull().references(() => society.id),
  weekLabel: text("week_label").notNull(),
  phase: text("phase", { enum: ["COLLECT", "BID", "COMMIT", "FULFIL", "RESOLVE", "CLOSED"] }).notNull().default("COLLECT"),
  deadlines: jsonb("deadlines").$type<CycleDeadlines>().notNull(),
  commitOpenedAt: timestamp("commit_opened_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  handoverAt: timestamp("handover_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const need = pgTable("need", {
  id: id(),
  cycleId: text("cycle_id").notNull().references(() => cycle.id),
  householdId: text("household_id").notNull().references(() => household.id),
  rawText: text("raw_text").notNull(),
  productId: text("product_id").references(() => product.id),
  qty: integer("qty").notNull(),
  brandFlexible: boolean("brand_flexible").notNull().default(false),
  source: text("source", { enum: ["text", "photo", "autopilot", "simulated"] }).notNull(),
  clarification: text("clarification"),
  status: text("status", { enum: ["active", "removed", "unmatched", "restricted"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const pool = pgTable(
  "pool",
  {
    id: id(),
    cycleId: text("cycle_id").notNull().references(() => cycle.id),
    productId: text("product_id").notNull().references(() => product.id),
    status: text("status", { enum: ["DRAFT", "OPEN_FOR_BIDS", "NO_BID", "PRICED", "SUCCEEDED", "FAILED", "DELIVERED", "SELLER_DEFAULTED"] })
      .notNull()
      .default("DRAFT"),
    demandEstimate: integer("demand_estimate").notNull().default(0),
    winningBidId: text("winning_bid_id"),
    finalUnitCents: integer("final_unit_cents"),
    keptQty: integer("kept_qty"),
    aiNotes: text("ai_notes"), // Pool Builder brief, visible to sellers
    aiRecommendation: text("ai_recommendation"), // Bid Analyst recommendation, captain-only
  },
  (t) => [uniqueIndex("pool_cycle_product").on(t.cycleId, t.productId)],
);

export const bid = pgTable("bid", {
  id: id(),
  poolId: text("pool_id").notNull().references(() => pool.id),
  sellerId: text("seller_id").notNull().references(() => seller.id),
  moq: integer("moq").notNull(),
  maxCapacity: integer("max_capacity").notNull(),
  tiers: jsonb("tiers").$type<Tier[]>().notNull(),
  deliveryWindow: text("delivery_window").notNull(),
  note: text("note"),
  status: text("status", { enum: ["submitted", "won", "lost", "withdrawn"] }).notNull().default("submitted"),
  commissionBps: integer("commission_bps"), // fixed when the bid wins (Policies §9.3)
  aiScore: integer("ai_score"),
  aiRationale: text("ai_rationale"),
  aiFlags: jsonb("ai_flags").$type<string[]>(),
  createdAt: createdAt(),
});

export const basket = pgTable(
  "basket",
  {
    id: id(),
    cycleId: text("cycle_id").notNull().references(() => cycle.id),
    householdId: text("household_id").notNull().references(() => household.id),
    status: text("status", {
      enum: ["DRAFT", "AWAITING_APPROVAL", "AUTHORIZED", "WITHDRAWN", "CAPTURED", "RELEASED", "PAYMENT_FAILED", "PARTIALLY_REFUNDED", "REFUNDED"],
    })
      .notNull()
      .default("DRAFT"),
    simulated: boolean("simulated").notNull().default(false),
    ceilingCents: integer("ceiling_cents").notNull().default(0),
    capturedCents: integer("captured_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("basket_cycle_household").on(t.cycleId, t.householdId)],
);

export const basketLine = pgTable(
  "basket_line",
  {
    id: id(),
    basketId: text("basket_id").notNull().references(() => basket.id),
    poolId: text("pool_id").notNull().references(() => pool.id),
    qty: integer("qty").notNull(),
    ceilingUnitCents: integer("ceiling_unit_cents").notNull(),
    finalUnitCents: integer("final_unit_cents"),
    refundedCents: integer("refunded_cents").notNull().default(0),
    status: text("status", { enum: ["draft", "committed", "won", "released", "refunded_partial", "refunded_full"] }).notNull().default("draft"),
  },
  (t) => [index("basket_line_pool").on(t.poolId)],
);

export const payment = pgTable("payment", {
  id: id(),
  basketId: text("basket_id").notNull().references(() => basket.id),
  mode: text("mode", { enum: ["sandbox", "mock"] }).notNull(),
  method: text("method", { enum: ["paypal_wallet", "card"] }).notNull(),
  paypalOrderId: text("paypal_order_id").notNull(),
  paypalAuthorizationId: text("paypal_authorization_id"),
  paypalCaptureId: text("paypal_capture_id"),
  authorizedCents: integer("authorized_cents").notNull(),
  capturedCents: integer("captured_cents").notNull().default(0),
  paypalFeeCents: integer("paypal_fee_cents").notNull().default(0),
  status: text("status", { enum: ["CREATED", "AUTHORIZED", "VOIDED", "CAPTURED", "DECLINED", "SUPERSEDED"] }).notNull(),
  honorExpiresAt: timestamp("honor_expires_at", { withTimezone: true }),
  authExpiresAt: timestamp("auth_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const issue = pgTable("issue", {
  id: id(),
  basketLineId: text("basket_line_id").notNull().references(() => basketLine.id),
  type: text("type", { enum: ["missing", "damaged", "wrong_item", "quality"] }).notNull(),
  qtyAffected: integer("qty_affected").notNull(),
  description: text("description").notNull(),
  photoDataUrl: text("photo_data_url"),
  aiAssessment: jsonb("ai_assessment").$type<{ classification: string; proposedRefundCents: number; confidence: string; rationale: string; source: "ai" | "rules" }>(),
  decision: text("decision", { enum: ["pending", "auto_approved", "approved", "rejected"] }).notNull().default("pending"),
  decidedBy: text("decided_by"),
  refundCents: integer("refund_cents"),
  createdAt: createdAt(),
});

export const refund = pgTable("refund", {
  id: id(),
  issueId: text("issue_id").references(() => issue.id),
  paymentId: text("payment_id").notNull().references(() => payment.id),
  paypalRefundId: text("paypal_refund_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  chargedTo: text("charged_to", { enum: ["seller", "platform"] }).notNull(),
  sellerId: text("seller_id").references(() => seller.id),
  createdAt: createdAt(),
});

export const payout = pgTable(
  "payout",
  {
    id: id(),
    cycleId: text("cycle_id").notNull().references(() => cycle.id),
    sellerId: text("seller_id").notNull().references(() => seller.id),
    grossCents: integer("gross_cents").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    refundsCents: integer("refunds_cents").notNull(),
    carriedCents: integer("carried_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    senderItemId: text("sender_item_id").notNull(),
    paypalBatchId: text("paypal_batch_id"),
    status: text("status", { enum: ["PENDING", "SENT", "SUCCESS", "FAILED", "CARRIED_FORWARD"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payout_sender_item").on(t.senderItemId)],
);

export const ledgerEntry = pgTable("ledger_entry", {
  id: id(),
  cycleId: text("cycle_id"),
  txnId: text("txn_id").notNull(), // groups balanced rows
  account: text("account", { enum: ["paypal_clearing", "seller_payable", "platform_revenue", "platform_expense"] }).notNull(),
  sellerId: text("seller_id"),
  debitCents: integer("debit_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  memo: text("memo").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  createdAt: createdAt(),
});

export const aiDecision = pgTable("ai_decision", {
  id: id(),
  agent: text("agent").notNull(),
  inputRef: text("input_ref").notNull(),
  output: jsonb("output").notNull(),
  model: text("model").notNull(), // model id, or "rules" when the AI fallback ran
  accepted: boolean("accepted"),
  acceptedBy: text("accepted_by"),
  createdAt: createdAt(),
});

export const webhookEvent = pgTable("webhook_event", {
  paypalEventId: text("paypal_event_id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// Verified facts behind supplier trust and resident reliability. Rows are never edited except to
// void one on appeal; scores are always recomputed from them (lib/engine/trust.ts).
export const trustEvent = pgTable(
  "trust_event",
  {
    id: id(),
    subjectType: text("subject_type", { enum: ["seller", "household"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    cycleId: text("cycle_id"),
    kind: text("kind", { enum: ["delivered", "issue_upheld", "commitment_kept", "payment_failed", "claim_rejected"] }).notNull(),
    score: integer("score").notNull(), // 0 (bad) .. 100 (good)
    weight: integer("weight").notNull().default(1), // e.g. number of lines delivered
    refId: text("ref_id"),
    note: text("note"),
    voided: boolean("voided").notNull().default(false),
    voidedBy: text("voided_by"),
    createdAt: createdAt(),
  },
  (t) => [index("trust_event_subject").on(t.subjectType, t.subjectId)],
);

export const activity = pgTable("activity", {
  id: id(),
  cycleId: text("cycle_id"),
  actor: text("actor").notNull(),
  kind: text("kind", { enum: ["phase", "money", "ai", "seller", "resident", "issue", "system"] }).notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
});
