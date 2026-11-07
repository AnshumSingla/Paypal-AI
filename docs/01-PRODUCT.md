# PoolCart — Product Spec

> Working name. Status: **DRAFT for review**. Hackathon: PayPal AI Hackathon (deadline Thu Nov 12 2026, 12:00 PT).

## 1. One-liner

PoolCart turns the separate grocery lists of everyone in an apartment community into one weekly bulk order. Local sellers compete to fill it, and every resident pays only the price the whole building unlocked.

## 2. Problem

- Households in the same building buy the same staples (rice, flour, oil, eggs, milk, detergent) every week, separately, at retail prices.
- Wholesalers and local distributors offer 10–30% lower prices, but only above a minimum order quantity (MOQ). No single household reaches it.
- Today, residents pool orders by hand in WhatsApp groups. One volunteer collects lists in a spreadsheet, chases payments, haggles with a vendor, and fronts the money. It breaks at about 15 households, and the volunteer carries the financial risk.
- Sellers have the opposite problem. Delivering to 40 doors costs more than delivering one bulk drop to a building, but they have no reliable way to find pre-committed, pre-paid demand.

## 3. Users and roles

| Role | Who | What they do |
|---|---|---|
| **Resident** | A household in a society | Adds needs, confirms their basket, approves one PayPal payment per week, collects the goods, reports issues |
| **Captain** | Volunteer or society admin (one or more per society) | Creates and configures the society, approves the winning bids (or lets auto-select run), receives the bulk drop, confirms handover |
| **Seller** | Local wholesaler, distributor, farm or grocery store | Onboards, browses pooled demand, bids tier prices, delivers, gets paid out, optionally subscribes to a paid plan |
| **Operator** | PoolCart platform | Approves sellers, sets policy, watches the money flows and ops dashboards |

## 4. Core concepts (glossary)

| Term | Meaning |
|---|---|
| **Society** | A residential community with one drop point (apartment complex, HOA, dorm, co-op) |
| **Cycle** | One weekly order round per society, e.g. "Maple Heights, week 46". It moves through fixed phases (see §6). |
| **Need** | A resident's free-text request, e.g. "2 dozen eggs, any brand". It doesn't commit them to anything. |
| **Canonical product** | A normalized product identity (name, brand or "any", pack size, unit), matched with Channel3 product data |
| **Pool** | All demand in one cycle for one canonical product. This is the unit sellers bid on. |
| **Bid** | A seller's offer for a pool: MOQ, price tiers by quantity, maximum capacity, delivery window. Prices include delivery to the drop point. |
| **Tier** | A price break, e.g. ≥20 packs → $4.80, ≥40 → $4.40, ≥80 → $4.10 |
| **Basket / Order** | A resident's confirmed lines across pools for one cycle. Backed by **one PayPal order with intent AUTHORIZE**. |
| **Settlement** | At cutoff: decide which pools succeeded, fix each pool's final tier, capture each resident's real total, release the rest |
| **Drop** | The bulk delivery for one cycle to the society's drop point |

## 5. Key mechanic: approve the ceiling, pay what the group unlocks

1. When a resident confirms their basket, PayPal **authorizes** (holds) the **ceiling price**: each line at the winning bid's highest tier price (the price at MOQ).
2. More residents join, total quantity crosses a tier, and the unit price falls for **everyone** in that pool.
3. At cutoff, PoolCart **captures only the final amount** (unlocked tier price × quantity, for pools that succeeded). The unused part of the hold is released automatically.
4. If a pool never reaches MOQ, those lines are never charged.

The rule residents see: **you will never pay more than you approved, and you usually pay less.**

PayPal pieces used: Orders v2 `intent=AUTHORIZE` → `POST /v2/payments/authorizations/{id}/capture` (partial, final) → `void` when nothing succeeded. The whole cycle fits inside PayPal's 3-day honor period (see Policies §1).

## 6. Weekly cycle (default schedule, configurable per society)

| Phase | Default window | What happens | Money |
|---|---|---|---|
| **1. Collect** | Mon 00:00 → Tue 20:00 | Residents add needs in plain language, by photo of a list, or as recurring staples. AI groups them into draft pools with demand estimates. | None |
| **2. Bid** | Tue 20:00 → Wed 20:00 | Sellers see the demand board (quantities only, no identities) and submit tier bids. AI ranks the bids; the captain approves winners, or auto-select runs at the deadline. | None |
| **3. Commit** | Wed 20:00 → Thu 20:00 | Residents see exact tier prices and confirm their basket with **one PayPal approval** (authorization). The live progress bar shows things like "3 more households → $0.40 off". | Authorization hold |
| **4. Settle** | Thu 20:00 (cutoff) | Pools at or above MOQ succeed; each resident's real total is captured and the rest released. Pools below MOQ fail and their lines are released. | Capture / void |
| **5. Fulfil** | Sat 09:00–12:00 | Seller delivers the bulk drop. The captain gets an AI-generated per-flat packing list, distributes, and confirms handover. | None |
| **6. Resolve & pay out** | Handover + 24h | Residents report missing or damaged items, and refunds are issued. Then each seller gets one PayPal payout, net of commission and refunds. | Refunds, Payouts |

A demo "time-travel" control moves a cycle through these phases instantly (see Build Plan).

## 7. AI features (what the AI actually does)

Rule for every feature: **the AI proposes and explains; deterministic code moves money.** Each AI output is a structured, schema-validated proposal that a human or a policy rule confirms.

| # | Agent / feature | Input → output | Who confirms |
|---|---|---|---|
| A1 | **Basket Assistant** | Free text, voice transcript, or a **photo of a handwritten list** → structured lines (canonical product, quantity, brand flexibility), matched against Channel3 for product identity and a retail reference price | Resident edits and confirms |
| A2 | **Pool Builder** | All needs in a cycle → pools. Merges compatible variants (for example "any basmati 5kg" with "Brand X basmati 5kg" only when the first resident marked "any brand"), flags pack-size conflicts, estimates demand | Captain reviews the board, or it auto-publishes at the end of Collect |
| A3 | **Seller Pricing Copilot** | Pool demand curve plus retail reference → suggested MOQ and tier sheet for the seller | Seller edits and submits |
| A4 | **Bid Analyst** | All bids on a pool → ranking by landed cost at projected quantity, seller rating and delivery fit, with a plain-English explanation. Flags anomalies (above retail, suspiciously below market). | Captain approves (or auto-select under policy) |
| A5 | **Momentum Nudger** | Pools close to a tier break → personalized, opt-in nudges to residents who bought this product before ("Eggs are 2 households from $3.10/dozen") | Sent only to opted-in residents; uses only their own history |
| A6 | **Issue Resolver** | Resident complaint plus photo → classification (missing, damaged, wrong item) and a proposed refund under policy limits | Auto-approved under the threshold, otherwise the captain or seller decides |
| A7 | **Insights Agent** (AG Studio Studio Agent Framework) | Plain-language questions ("savings per household this month", "why did the oil pool fail?") → live AG Studio widgets over PayPal and ledger data | Read-only |
| A8 *(stretch)* | **Restock Autopilot** | Resident sets a mandate ("milk + eggs every week, max $15") → agent pre-fills the basket each cycle and sends a one-tap approve | Resident approves each week. Full auto-pay would need Vault, which this sandbox app doesn't support (Policies §14). |

## 8. Business model

| Stream | Default (to finalize) | PayPal product |
|---|---|---|
| **Seller commission** | % of each settled pool's gross, deducted at payout | Payouts (net amount) |
| **Seller subscription** | Starter: free, 8% commission · Pro: $19/mo, 4% + 12h early demand-board access + Pricing Copilot · Partner: $49/mo, 2.5% + priority in tie-breaks | **Subscriptions** (Billing Plans) |
| Residents | Free | — |
| Societies / captains | Free (future: captain perks) | — |

Unit example: a 40-household society with a $35 average weekly basket is $1,400 GMV per week. At a blended 5% commission that is $70 per week per society for the platform. Residents save about 15–25% against the Channel3 retail reference.

## 9. Success metrics (shown in the dashboards)

- **Household savings** vs. retail reference ($ and %), per cycle and over time
- **Pool success rate** (pools that reached MOQ / pools opened)
- **Tier depth** (average tiers unlocked per pool)
- **Seller fill rate** and on-time drops
- **Issue rate** and refund $ per cycle
- **Payout latency** (handover → seller paid)

## 10. Market framing and currency

- The sandbox runs in **USD**. The demo story is a US apartment complex or HOA ("Maple Heights"), and the pitch generalizes to housing societies, dorms and co-ops worldwide.
- PayPal doesn't support domestic INR payments, so an India rollout would need a local payment partner. The pitch should say this honestly rather than claim India readiness.

## 11. Out of scope for the hackathon

- Real seller identity verification or document upload (simulated with operator approval)
- Taxes and seller invoices (noted in Policies)
- Production marketplace payment splitting (PayPal Multiparty needs partner approval; see Architecture §9)
- Native mobile apps (responsive web only)
- Cold-chain logistics (perishables are flagged, not handled specially)
