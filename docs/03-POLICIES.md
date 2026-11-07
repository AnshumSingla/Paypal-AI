# PoolCart — Platform Policies

> Status: **DRAFT for review**. These policies are product rules that the code enforces. Every rule tagged **[ENFORCED]** has a check in the engine and should have a test. Numbers marked *(tunable)* are defaults stored in config.
>
> Hackathon note: PoolCart runs in the PayPal **sandbox**. No real money moves. These policies describe how the product would behave.

---

## 1. Payment holds (authorization) policy

1.1 **We hold, we don't escrow.** When a resident confirms a basket, PoolCart asks PayPal to *authorize* (hold) the ceiling amount. In product copy this is called a "payment hold", never "escrow".

1.2 **Ceiling = highest possible price.** Each line is held at the winning bid's highest tier price (the price at MOQ) × quantity. **[ENFORCED]**

1.3 **Never capture more than the hold.** Captured total ≤ authorized total, always. **[ENFORCED]** (assertion in settlement; the cycle aborts if violated)

1.4 **Capture inside the honor period.** PayPal authorizations are valid for 29 days, and capture success is highest within the first 3 days. PoolCart's schedule validator rejects any society schedule where `cutoff − commit_open > 72h`. **[ENFORCED]** If settlement is delayed (incident) beyond day 3, the engine reauthorizes once before capturing; beyond day 29, the basket must be re-confirmed by the resident.

1.5 **Release quickly.** Holds on failed pools, withdrawn baskets and fully failed baskets are released at settlement (void, or the automatic release of the rest of a final partial capture). Product copy: "Your bank may take a few days to show the release."

1.6 **One hold per resident per cycle.** Changing a basket after confirming voids the old hold and creates a new one. **[ENFORCED]**

## 2. Pricing and tier policy

2.1 Seller bids define `moq`, `max_capacity` and 1–5 tiers `{min_qty, unit_price}`, with `unit_price` strictly decreasing as `min_qty` rises. The first tier's `min_qty` must equal the MOQ. **[ENFORCED]**

2.2 **Everyone in a pool pays the same final unit price.** It's the tier reached by the total quantity *kept* at cutoff. **[ENFORCED]**

2.3 Bid prices are **landed**: they include delivery to the society drop point. There's no separate delivery fee in the MVP.

2.4 Once the Commit phase opens, a winning bid's prices are **locked** for that cycle. Sellers can't raise prices; they may *add* a deeper tier. **[ENFORCED]**

2.5 Price sanity: the Bid Analyst flags bids above the Channel3 retail reference (a pool must save residents money) and bids more than 40% below it *(tunable)* (possible error or bait). Flagged bids need captain or operator approval to win.

## 3. Cycle and cutoff policy

3.1 Default weekly schedule: Collect Mon–Tue 20:00 · Bid → Wed 20:00 · Commit → Thu 20:00 (cutoff) · Drop Sat 09:00–12:00 · Issue window handover + 24h · Payout after the window. Times use the society's timezone.

3.2 Deadlines are hard. Late needs roll to the next cycle. **[ENFORCED]**

3.3 A pool with no valid bid at the bid deadline becomes `NO_BID`. Its needs are shown to the resident as "not available this week, carried to next week?" (one tap).

## 4. Resident commitment, withdrawal and changes

4.1 Needs in the Collect phase are non-binding.

4.2 After confirming a basket (hold placed), a resident may **withdraw or edit until cutoff**. Withdrawal voids the hold. **[ENFORCED]**

4.3 After cutoff, orders are final except for issues (§8).

4.4 Max quantity per line per household *(tunable, default 10 packs)* stops one household from cornering capacity or gaming tiers. **[ENFORCED]**

## 5. Pool success, failure and capacity

5.1 At cutoff: total committed quantity ≥ MOQ → **SUCCEEDED**; otherwise **FAILED** and every line in the pool is released (not charged). **[ENFORCED]**

5.2 If committed quantity > seller `max_capacity`, lines are kept in order of when their hold was placed (first committed, first served), whole lines only. Overflow lines are released and the resident is told. **[ENFORCED]**

5.3 If a resident's capture fails at settlement, their lines are removed and the pool is re-evaluated before anyone else is charged (Architecture §8). **[ENFORCED]**

## 6. Substitution policy

6.1 Residents choose per line: **Exact brand** or **Any brand of this pack size** (default: exact).

6.2 Only "any brand" needs may be merged into a pool for a different brand. The Pool Builder can *propose* a merge; it never applies one to an exact-brand need. **[ENFORCED]**

6.3 Sellers may not substitute at delivery without the resident's in-app consent. Unapproved substitutes count as `wrong_item` issues (§8).

## 7. Delivery and handover policy

7.1 Delivery is to the society's single drop point during the window in the winning bid.

7.2 The captain (or a delegate) checks the drop against the AI-generated **drop manifest** (per-pool totals) and confirms handover in the app, noting shortages at drop level. That starts the 24h issue window.

7.3 The captain distributes using the **per-unit packing list** (B-1204: 2× eggs, 1× oil…). Residents tap "Received" or report an issue.

7.4 Seller no-show (no handover by window end + 2h *(tunable)*): pool → `SELLER_DEFAULTED`, every affected line is **fully refunded** within 24h, and the seller gets a strike (§10).

## 8. Issues, refunds and disputes

8.1 Residents may report `missing`, `damaged`, `wrong_item` or `quality` issues **within 24h of handover**, with a photo for damaged, wrong or quality issues.

8.2 The Issue Resolver AI classifies the report and proposes a refund amount of `qty_affected × final_unit_price`. It can never propose more than the captured amount for that line. **[ENFORCED]**

8.3 Auto-approval: refunds ≤ $10 *(tunable)* per issue, where the household has had fewer than 3 auto-approved issues in the last 30 days, are approved automatically. Everything else goes to the captain, and to the seller for comment, with a 24h SLA.

8.4 Refunds are made as PayPal partial refunds on the resident's capture. They are charged to the **seller** (deducted from payout) unless the captain marks a drop-level shortage the seller disputes. In that case the operator decides, and the platform absorbs the cost if it can't be resolved.

8.5 If a seller's payout has already gone out (late issue), the refund is a negative balance carried into the seller's next payout. Sellers with a negative balance can't win new bids until it's cleared. **[ENFORCED]**

8.6 PayPal buyer disputes (opened directly in PayPal) are handled by the operator. The platform answers with evidence (handover record, photos, manifest). PoolCart never auto-accepts a dispute.

## 9. Fees, commission and subscriptions

9.1 **Residents pay no platform fee.** They pay only the captured goods total.

9.2 **Seller commission** on the gross captured amount of each succeeded pool, by plan *(tunable)*:

| Plan | Price (PayPal Subscription) | Commission | Perks |
|---|---|---|---|
| Starter | Free | 8% | Bid on open pools |
| Pro | $19 / month | 4% | 12h early demand-board access, Seller Pricing Copilot, analytics |
| Partner | $49 / month | 2.5% | Pro perks + priority in tie-breaks + multi-society bidding |

9.3 The commission rate is fixed by the seller's plan **at the moment the bid wins**. A plan change mid-cycle doesn't affect existing bids. **[ENFORCED]**

9.4 PayPal processing fees on resident captures are absorbed by the platform out of its commission. Sellers receive `gross − commission − refunds` net, in USD.

9.5 Subscription billing runs through PayPal Subscriptions. If a subscription payment fails, the seller is downgraded to Starter after a 7-day grace period *(tunable)*, and future bids use Starter commission.

## 10. Seller onboarding and conduct

10.1 **Onboarding:** business name, contact, PayPal payout email, product categories, service area (societies), and a food-business license reference where the jurisdiction requires one. Status starts `pending`; the operator approves. *(Hackathon: approval is a button; no document verification.)*

10.2 **Bids are binding.** A seller may withdraw a bid before it wins. After winning, withdrawing counts as a default (§7.4).

10.3 **Strikes:** a no-show, more than 20% of lines with upheld issues in a cycle, or price-locking violations each add 1 strike. 2 strikes in 90 days means a 30-day suspension; 3 means removal. **[ENFORCED]** for suspension (can't bid).

10.4 **Rating** = rolling 90-day average of resident delivery ratings plus fill rate. It's an input to the Bid Analyst.

10.5 **Conflict of interest:** a captain can't be the seller of record (or a staff member of one) for their own society's pools. **[ENFORCED]** by user-role separation.

## 11. Seller payout policy

11.1 Payout runs once per seller per cycle, after the issue window closes and all issues for that seller are decided.

11.2 `net = Σ won-line totals − commission − refunds charged to seller − negative balance carried forward`. A net ≤ 0 is carried forward; no payout is sent. **[ENFORCED]**

11.3 Sent with PayPal Payouts, one item per seller, `sender_item_id = "{cycle_id}:{seller_id}"` for idempotency. Retries reuse the same id. **[ENFORCED]**

11.4 A failed payout item (for example an unclaimed or invalid email) is shown to the seller, held, and retried after they fix their payout email.

## 12. Society and captain policy

12.1 Any resident can create a society; they become its first captain. Additional households join with an invite link or code.

12.2 A society needs at least 5 households *(tunable)* before its first cycle opens.

12.3 Captains can configure the schedule (within §1.4), auto-select bids, invite or remove households, and confirm handovers. Captains can't see other residents' payment details, only items and quantities per unit.

12.4 Auto-select: if it's on, the top-ranked unflagged bid wins at the bid deadline unless a captain overrides it.

## 13. Privacy and data policy

13.1 Data minimization: residents' unit label, name and items. No home address beyond the society drop point. Payment details stay with PayPal; PoolCart stores only PayPal IDs and amounts.

13.2 **Sellers see aggregates only** (pool quantities, society name, drop point, window), never individual residents. **[ENFORCED]** at the API layer.

13.3 Nudges are opt-in, use only the recipient's own purchase history, and never reveal who else joined a pool.

13.4 AI processing: needs, photos of lists and issue photos are sent to the LLM provider for processing. This is disclosed in the UI. The hackathon build uses no data for training.

13.5 Residents may delete their account. Ledger and payment records are kept (anonymized) for financial integrity.

## 14. AI usage and guardrails

14.1 **AI never moves money.** No agent has a tool that calls PayPal write APIs. Captures, voids, refunds and payouts happen only in the deterministic engine on state transitions. **[ENFORCED]** by architecture.

14.2 Every AI suggestion is shown with a "Why?" explanation and logged in `ai_decision` with who accepted it.

14.3 Human confirmation points: the resident confirms parsed baskets; the captain confirms pools and winning bids (or opts into auto-select under §12.4); refunds above the auto-approve threshold are human-decided.

14.4 Free text from residents and sellers is treated as data, not instructions, in all prompts.

14.5 If the LLM is down or returns invalid output, the user gets a manual path (manual item entry, manual bid sort). The cycle never blocks on AI.

14.6 **Restock Autopilot (stretch)** only pre-fills a basket within a resident-set mandate (items + weekly cap) and sends a one-tap approval. Fully unattended payment would need PayPal Vault (saved payment method). That isn't assumed here, because vaulting can be disabled per account (sandbox error `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE` reported in the hackathon forum).

## 15. Product restrictions

15.1 Allowed in the MVP: packaged groceries, staples, household and cleaning supplies, personal care.

15.2 Flagged (allowed with a warning, seller must confirm handling): perishables (dairy, eggs, produce, frozen).

15.3 Not allowed: alcohol, tobacco and vapes, medicines and supplements with health claims, weapons, age-restricted items, live animals. The Basket Assistant refuses these, and the catalog blocks them. **[ENFORCED]**

## 16. Compliance notes (honest limits)

- **Sandbox only.** No live credentials anywhere in the repo.
- **Marketplace model:** in production, platform-as-merchant-of-record plus payouts to sellers raises money-transmission and marketplace-facilitator questions. The intended production path is **PayPal Multiparty** (sellers onboarded as merchants, `platform_fees` for commission), which needs PayPal partner approval.
- **Taxes:** sales tax, GST and seller invoicing are out of scope for the hackathon. In production, sellers issue tax invoices per pool, and the platform invoices its commission.
- **Geography:** PayPal doesn't support domestic INR payments, so an India rollout needs a local payment partner. The demo uses USD.
- **Food safety and liability** rest with the licensed seller. The platform is a marketplace facilitator.
