# Collective: policies

These are the product rules. Each rule says whether code enforces it. "Not built" means the rule is a product intention with no code behind it yet. Collective runs in the PayPal sandbox; no real money moves.

## 1. Payment holds

| Rule | Status |
|---|---|
| 1.1 A confirmed basket places a PayPal authorization ("payment hold"), never called escrow. | Enforced |
| 1.2 The hold is the ceiling: each line at the winning bid's tier-1 price (the price at MOQ) times quantity. The amount is computed on the server. | Enforced (`basketCeiling`, `ceilingUnit`) |
| 1.3 Never capture more than the hold. Settlement checks `total <= authorized` before each capture; a basket that fails the check is marked `PAYMENT_FAILED` and its lines are released. The mock gateway and PayPal also refuse over-captures. | Enforced |
| 1.4 Capture inside PayPal's 3-day honor period. Each hold's honor and 29-day expiry times are recorded. There is no schedule validator or reauthorization; phases advance by hand, so in the demo cutoff comes minutes after the holds. | Recorded, not enforced |
| 1.5 Unused holds are released at cutoff: voided when nothing was won, otherwise released by PayPal after the final capture. | Enforced |
| 1.6 One hold per basket. Editing a held basket voids the hold and the resident confirms again. | Enforced (`releaseHoldForEdit`) |

## 2. Pricing and tiers

| Rule | Status |
|---|---|
| 2.1 A bid has an MOQ, a capacity of at least the MOQ, and 1 to 5 tiers. Tier 1 starts at the MOQ, quantities rise, prices strictly fall, and no tier starts above capacity. | Enforced (`validateTiers`) |
| 2.2 Tier 1 must be below the product's retail reference. | Enforced at bid submission |
| 2.3 Everyone in a pool pays the same final unit price: the tier reached by the quantity kept at cutoff. | Enforced (`settlePool`) |
| 2.4 After a bid wins, prices can only go down. A supplier may add a cheaper break; tier 1 never changes, so captures stay within holds (see §3). | Enforced (`newTierProblem`, `addTier`) |
| 2.5 Code flags bids at or above retail, bids more than 40% below retail (possible error or bait), and MOQs well above demand. Auto-select skips the first two kinds; the captain can still pick any bid by hand. | Enforced |
| 2.6 Bid prices include delivery to the drop point. | Product rule; no delivery fee exists in code |

## 3. Money on the table

During Confirm and pay, the Society Secretary may ask a winning supplier for a lower price at the quantity already authorized in PayPal (`fundedAsk`). A new price break is accepted only if:

- it starts above tier 1's quantity and at or below the bid's capacity, at a quantity with no existing break;
- it is cheaper than the break below it and dearer than the break above it;
- it is not below the supplier's floor;
- the sheet stays at 5 breaks or fewer.

In the demo the supplier's answer is a rule in code: concede about 4% of retail per ask, never below a private floor of 70% to 75% of retail. A real supplier would set these itself.

## 4. Cycle and commitment

| Rule | Status |
|---|---|
| 4.1 Needs can be added only during Collect. | Enforced |
| 4.2 Baskets can be edited, confirmed or withdrawn only during Confirm and pay. Withdrawal voids the hold. After cutoff, orders are final except for issues. | Enforced |
| 4.3 At most 10 packs per product per household (`society.max_qty_per_line`). | Enforced |
| 4.4 A pool with no eligible bid at close of bidding becomes `NO_BID`. Carrying those needs to next week is not built. | Partly enforced |
| 4.5 Phase changes are guarded so a double click cannot run a transition twice. | Enforced |
| 4.6 Payouts wait until no issue is pending. | Enforced |

## 5. Pool success and capacity

| Rule | Status |
|---|---|
| 5.1 At cutoff a pool with committed quantity at or above MOQ succeeds; below MOQ it fails and none of its lines are charged. | Enforced |
| 5.2 Over capacity, whole lines are kept in the order their holds were placed; the rest are released. | Enforced |
| 5.3 Holds that are no longer valid at cutoff are removed before any pool is priced. | Enforced (dry run) |
| 5.4 A capture that fails releases that basket's lines only. Re-pricing the pool for other baskets is not built. | Partly enforced |

## 6. Substitution

- Residents' needs record whether any brand is acceptable (`brand_flexible`).
- The Pool Builder may suggest merging brand-flexible demand, as text for the captain. Code never merges pools. Enforced by the absence of any merge code.
- Substitution at delivery is not modelled; an unapproved substitute can be reported as `wrong_item`.

## 7. Delivery and handover

- The captain checks the drop against per-product totals and hands out by flat using the packing list, then confirms handover. That opens the 24-hour issue window and records a `delivered` trust event per pool for its supplier. Enforced.
- Supplier no-shows, `SELLER_DEFAULTED` pools and strikes are not built.

## 8. Issues and refunds

| Rule | Status |
|---|---|
| 8.1 Issues (`missing`, `damaged`, `wrong_item`, `quality`) can be reported only on delivered lines, during the issue window, within 24 hours of handover. Damaged, wrong and quality claims need a photo. | Enforced |
| 8.2 The Issue Resolver proposes `affected packs x price paid`, capped by code at what is still refundable for the line. | Enforced |
| 8.3 The Society Secretary decides first. It may refund only through `agentRefund`, which refuses a refund over $10, over the line's refundable amount, on an issue already decided, or when the household already had 3 automatic refunds in 30 days. Anything else goes to the captain. | Enforced (`agentRefundProblem`) |
| 8.4 The captain approves or rejects escalated issues. A captain refund is capped at the line's refundable amount but not at $10. A rejection records a `claim_rejected` event for the household. | Enforced |
| 8.5 Refunds are PayPal partial refunds on the resident's capture and are charged to the supplier's payout. Platform-absorbed refunds are not built. | Enforced (supplier only) |
| 8.6 A refund recorded after a cycle closed becomes a negative supplier balance, and a supplier with a negative balance cannot bid. | Enforced |
| 8.7 Each refunded issue records an `issue_upheld` trust event (weight 3) against the supplier. | Enforced |
| 8.8 PayPal buyer disputes are handled by the operator outside the app. | Not built |

## 9. Fees, commission and plans

| Plan | Price | Commission |
|---|---|---|
| Starter | Free | 8% |
| Pro | $19/month (PayPal Subscriptions) | 4% |
| Partner | $49/month (PayPal Subscriptions) | 2.5% |

- Residents pay no platform fee. Enforced.
- The commission rate is fixed on the bid when it wins; a later plan change does not affect it. Enforced (`bid.commission_bps`).
- A paid plan is granted only after the server reads the subscription from PayPal and checks it is active on the right plan. Enforced in sandbox mode.
- PayPal fees on captures are booked as platform expense. Enforced.
- Plan perks other than commission (early demand access, tie priority, multi-society bidding) are not built. Downgrading after a failed subscription payment is not built; the webhook only records the status.

## 10. Suppliers

- New suppliers start `pending`; only `approved` suppliers can bid. The operator approves or suspends with a button; there are no document checks. Enforced.
- One live bid per supplier per pool: a new bid replaces the old one. A supplier can withdraw a bid before it wins. Enforced.
- Supplier trust (0 to 100) is computed only from `trust_event` rows: prior 75 worth 20 events, 90-day half-life, `issue_upheld` weight 3. It counts for 45 of 100 points in the bid score. Enforced.
- Appeals: the engine can void a trust event (`voidTrustEvent`) so it stops counting. There is no appeal screen yet.

## 11. Payouts

| Rule | Status |
|---|---|
| 11.1 Payouts run once per cycle when it closes, after all issues are decided. A second run does nothing. | Enforced |
| 11.2 `net = gross - commission - refunds charged to the supplier + any negative balance`. A net of zero or less is carried forward and no payout is sent. | Enforced |
| 11.3 One PayPal Payouts item per supplier with `sender_item_id = "{cycle_id}:{seller_id}"`, unique in the database. | Enforced |
| 11.4 A failed batch or item is marked `FAILED` and can be retried from the supplier portal with the same `sender_item_id`. Payout status can be refreshed from PayPal. | Enforced |

## 12. Society and captain

- The captain picks winning bids or lets auto-select pick the top unflagged score at close of bidding (`auto_select_bids`, on by default). Enforced.
- The captain sees items per flat and money totals, never PayPal payer details (none are stored).
- Creating societies, invite links and minimum society size are not built. The demo has one seeded society.

## 13. Privacy

- Suppliers see pool totals and the society name only, never who ordered what. Enforced in the supplier pages and the supplier's Secretary tools.
- Collective stores PayPal ids and amounts, not payment details.
- Lists, list photos and issue photos are sent to the Claude API when AI is on. Issue photos are stored in the database.
- Nudges and account deletion are not built.

## 14. AI guardrails

| Rule | Status |
|---|---|
| 14.1 No agent can capture, void or pay out. The Secretary's only money tool is a refund that code limits (§8.3). | Enforced by design |
| 14.2 Scores, prices, tier validity and refund caps are computed in code; AI explains, flags and proposes. | Enforced |
| 14.3 Every agent run is logged in `ai_decision` with the model, or `rules` for the fallback, and shown in the operator's AI log. | Enforced |
| 14.4 Resident and supplier free text is wrapped as data in every prompt. | Enforced (`asData`) |
| 14.5 If Claude is off, fails, refuses or returns invalid output, a rules fallback runs, so the cycle never blocks on AI. If a Secretary tool already acted, the fallback does not act again. | Enforced |
| 14.6 Claude calls are capped per hour (`AI_CALLS_PER_HOUR`). | Enforced |

## 15. Product restrictions

- Alcohol, tobacco and vapes, medicines and supplements are blocked: the Basket Assistant marks them restricted, restricted catalog items are never offered, and restricted lines are not saved. Enforced.
- Perishables are flagged in the catalog only.

## 16. Honest limits

- Sandbox only; there is no live PayPal endpoint in the code.
- Collective acts as merchant of record and pays suppliers with Payouts. Production would move to PayPal Multiparty, which needs partner approval.
- Taxes and invoices are out of scope.
- PayPal does not process domestic INR payments, so the Indian demo society pays in USD.
- Food safety rests with the supplier.
