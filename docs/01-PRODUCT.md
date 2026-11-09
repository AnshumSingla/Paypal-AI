# Collective: product

Built for the PayPal AI Hackathon. Sandbox only: no real money moves.

## One-liner

Collective lets a housing society buy groceries in bulk together. Residents add their weekly needs, local suppliers bid volume-tiered prices on the building's combined demand, and each resident approves one PayPal hold for the highest possible price. At cutoff Collective charges only the price the whole building unlocked and releases the rest.

The rule residents see: you never pay more than you approved, and you usually pay less.

## Problem

- Households in one building buy the same staples every week, separately, at retail prices.
- Wholesalers sell for less, but only above a minimum order quantity (MOQ) that no single household reaches.
- Pooling by hand in a group chat means one volunteer collects lists, chases payments and fronts the money.
- Suppliers would rather make one drop to a building than many doorstep deliveries, but they have no way to find demand that is already committed and paid for.

## Demo society

The seeded demo (`lib/db/seed.ts`) is fictional:

| Role | Who |
|---|---|
| Society | Gulmohar Residency, Pune: 40 households, drop point "Clubhouse store room, Tower A" |
| Resident persona | Ananya Kulkarni, household `hh_31` |
| Captain persona | Rohan Mehta, a volunteer resident |
| Supplier persona | Sharma Wholesale Traders (`sel_fresh`) |
| Other suppliers | Deccan Staples Co., Annapurna Kirana Mart (approved); Sahyadri Bulk Foods (pending operator approval) |
| Operator persona | Collective Ops |

Prices are in USD because PayPal does not process domestic INR payments. The catalog uses USD prices and US pack sizes. An India launch would need a local payment partner.

Weeks 43 to 45 are already complete when the demo starts: they run through the real engine offline at seed time (see [02-ARCHITECTURE](02-ARCHITECTURE.md), "Demo support"), and Week 46 is open with needs from up to 28 neighbours already added (Ananya has not added hers).

## Roles

| Role | What they do in the app |
|---|---|
| Resident | Types or photographs a list, confirms a basket, approves one PayPal hold, reports problems after delivery, asks the Secretary questions |
| Captain | Closes collection and bidding, picks winning bids (or lets auto-select pick), asks the Secretary to negotiate, confirms handover, decides escalated refunds |
| Supplier | Sees pooled totals (never who ordered what), bids MOQ and price tiers with optional AI tier suggestions, gets paid by PayPal Payouts, can upgrade its plan with PayPal Subscriptions |
| Operator | Approves or suspends suppliers, sees the ledger, AI decision log, webhooks and the AG Studio analytics dashboard |

There is no real sign-in. A persona menu switches roles with a cookie (demo mode).

## The weekly cycle

Phases advance when the captain (or anyone, in demo mode) presses the button for the next step, or when the guided demo runs a step. There is no scheduler or cron job; the stored deadlines are for display only.

| Phase | What happens | Money |
|---|---|---|
| Collect | Residents add needs as text or a photo of a handwritten list. The Basket Assistant matches items to the catalog and blocks restricted goods. | None |
| Bid | Each product with demand becomes a pool. Suppliers bid an MOQ, capacity and up to 5 price tiers. Code scores the bids; the AI explains them. The captain picks winners, or auto-select picks the top unflagged score when bidding closes. | None |
| Confirm and pay | Residents' needs become draft baskets at ceiling prices. Each resident confirms with one PayPal hold. Tier bars show how far the next price break is. The Secretary can ask suppliers for a lower price on the money already authorized. | Authorization hold |
| Cutoff | Pools at or above MOQ succeed; over-capacity lines are cut first-committed-first-served. Each hold is captured at the final price, or voided if nothing succeeded. | Capture or void |
| Delivery | The captain checks the drop against per-product totals and a per-flat packing list, then confirms handover. | None |
| Issue window | Residents report missing, damaged, wrong or poor-quality items within 24 hours. The Secretary refunds small claims itself and escalates the rest. | Refunds |
| Closed | Each supplier is paid once through PayPal Payouts, net of commission and refunds. | Payouts |

## Key mechanic: approve the ceiling, pay what the building unlocks

1. When a resident confirms, PayPal authorizes the ceiling: each line at the winning bid's first-tier price (the price at MOQ).
2. As more households confirm, total quantity crosses tiers and the unit price falls for everyone in that pool.
3. At cutoff Collective makes one final capture per basket for the real total. PayPal releases the rest of the hold.
4. Lines in pools that miss their MOQ are never charged.

PayPal pieces: Orders v2 with `intent=AUTHORIZE`, then `POST /v2/payments/authorizations/{id}/capture` with `final_capture=true`, or `void` when nothing succeeded.

## The Society Secretary

One Claude agent works for the building (`lib/ai/secretary.ts`). It reads state and acts only through tools, and engine code enforces every limit.

- **Decides issues.** It reads the issue and the limits, then refunds through PayPal or escalates to the captain. A refund it issues must be $10 or less, no more than was charged for that line, one per issue, and the household must have had fewer than 3 automatic refunds in 30 days.
- **Puts money on the table.** During Confirm and pay it tells each winning supplier how many households and dollars are already authorized and asks for a lower price at that quantity (see below).
- **Answers questions** from residents, captains and suppliers, using tools scoped to the asker's role.

It cannot capture, void or pay out. Settlement code does that at cutoff and after the issue window. Without an Anthropic key, a fixed rules playbook calls the same engine functions.

## Supplier trust

Supplier trust is a 0 to 100 score computed from verified events, never from free-text reviews (`lib/engine/trust.ts`):

- `delivered`: one event per delivered pool, weighted by lines served.
- `issue_upheld`: one event per refunded issue, weighted 3 (one complaint counts as much as three good lines).
- Smoothed towards a prior of 75 (worth 20 events) with a 90-day half-life.

Bids are scored in code: price at current demand 40 points, trust 45, MOQ reachability 15. A cheaper bid only wins when its price gap outweighs the trust gap. The seeded history gives the three active suppliers different issue rates, so their scores differ on day one.

Residents also get reliability events (`commitment_kept`, `payment_failed`, `claim_rejected`). These are recorded but not yet shown or used in any decision. An appeal function (`voidTrustEvent`) exists in the engine; there is no appeal screen yet.

## Money on the table

During Confirm and pay, the Secretary takes the funded demand for a pool to its winning supplier (`lib/engine/negotiation.ts`). The supplier's answer is a rule in code: concede about 4% of retail per ask, never below its private floor (a share of retail, demo data). If it accepts, a new cheaper price break is added at the quantity already authorized.

Code allows a new break only if it is cheaper than the break below it, above the break after it, within capacity, at or above the floor, and the sheet stays at 5 breaks or fewer. Tier 1, which every hold was sized on, never changes, so every capture still fits inside its hold.

## AI features

Rule for every feature: AI proposes and explains; deterministic code moves money. The only exception is the Secretary's refund tool, which calls the same limit-checked engine function a rule would.

| Feature | What it does | Status |
|---|---|---|
| Basket Assistant | Text or photo of a list to catalog lines; Channel3 lookup for unknown items; blocks restricted goods | Built. Photos need the Claude key. |
| Pool Builder | One-sentence seller note per pool; merge ideas as text only | Built |
| Pricing Copilot | Suggests MOQ, capacity and tiers for a supplier, validated by code | Built |
| Bid Analyst | Explains code-computed scores and flags (at or above retail, more than 40% below retail, MOQ well above demand) | Built |
| Issue Resolver | Classifies a complaint (with photo) and proposes `affected packs x price paid` | Built |
| Society Secretary | Tool-using agent described above | Built |
| AG Studio analyst | Answers questions in the operator dashboard and builds charts | Built. Needs the Claude key. |
| Momentum Nudger | Opt-in nudges near a price break | Not built |
| Restock Autopilot | Recurring basket within a resident mandate | Not built |

Every AI call has a rules fallback and writes an `ai_decision` row with the model used (or `rules`).

## Business model

| Stream | In code |
|---|---|
| Supplier commission | Fixed by plan when a bid wins: Starter 8%, Pro 4%, Partner 2.5%. Deducted at payout. |
| Supplier plans | Pro $19/month and Partner $49/month through PayPal Subscriptions. Only the commission rate differs by plan; the other perks listed on the plan card are not built. |
| Residents and captains | Free |

## What the dashboards show

- Captain: households with needs, pools priced, money held or charged in PayPal, savings against retail.
- Operator: platform revenue, PayPal fees absorbed, money owed to suppliers, ledger balance, supplier trust.
- AG Studio dashboard: savings by week and product, pool outcomes, holds against charges, payouts, and supplier trust with delivered lines and complaints.

## Out of scope

- Real sign-in, supplier identity checks and document upload (operator approval is a button)
- Taxes and invoices
- PayPal Multiparty (sellers as merchants); the demo uses merchant of record plus Payouts
- Scheduled phase changes, notifications and native apps
- Cold-chain handling (perishables are only flagged in the catalog)
