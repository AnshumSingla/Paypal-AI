# Collective: status and roadmap

Hackathon deadline: Thu Nov 12 2026, 12:00 PT. This page lists what is built, what is not, how it is tested, and the guided demo.

## Built

| Area | What works |
|---|---|
| Weekly cycle | Collect, Bid, Confirm and pay, cutoff, Delivery, Issue window, Closed; guarded transitions triggered by the captain or demo controls |
| Resident | Typed or photographed list, basket editing, one PayPal hold (PayPalButtons or sandbox test card), withdraw, receipt with "Check this with PayPal", issue reports |
| Captain | Demand board (AG Grid), ranked bids with trust, auto-select, money on the table, drop check and packing list, escalated issues |
| Supplier | Pooled demand, bid builder with AI tier suggestions, won pools, payouts with status refresh and retry, plan upgrade with PayPal Subscriptions |
| Operator | Revenue, fees, payables, ledger balance, ledger and AI log grids, supplier approval and trust, webhooks, AG Studio dashboard with an AI analyst |
| Society Secretary | Tool-using agent for issues, funded price asks and questions, with a rules playbook |
| Trust ledger | `trust_event` table, supplier score used in bid ranking, resident reliability events recorded |
| PayPal | Authorize, partial final capture, void, partial refund, Payouts, Subscriptions, webhook verification; in-process mock with restart recovery |
| Operations | `PAYPAL_MODE=mock`, `AI_MODE=rules`, hourly AI budget, Render blueprint (web + Postgres) |
| Demo | Seeded Gulmohar Residency, weeks 43 to 45 of history run through the real engine, simulators, reset, 12-step guided demo |

## Not built

- Momentum Nudger and Restock Autopilot
- Scheduled phase changes (no cron job or worker; the deadlines are for display)
- Honor-period schedule validation and reauthorization
- Re-pricing other baskets after one capture fails (that basket's lines are released only)
- Supplier no-shows, `SELLER_DEFAULTED`, strikes, disputes
- Plan perks other than commission; downgrade after a failed subscription payment
- Trust appeal screen (the engine function exists) and any use of resident reliability scores
- Carrying `NO_BID` needs to the next week
- Society creation, invites, real sign-in, account deletion
- Transaction reporting (`/v1/reporting/transactions`), PayPal Multiparty, Vault
- PayPal Agent Toolkit at runtime. The PayPal AI Toolkit and APIMatic's Context Plugin were used in Claude Code while building the integration; the app itself runs on PayPal's APIMatic-generated Server SDK.

## Tests

`npm test` runs Vitest on in-memory PGlite with the PayPal mock and rule-based AI.

| Suite | Covers |
|---|---|
| `pricing.test.ts` | Tier pricing, next-break hints, invalid sheets, MOQ failure, tier 2 pricing, capacity cut first-committed-first-served |
| `cycle.test.ts` | A full week: rules parsing and restricted items, pools, bid at retail rejected, auto-select and prefill, hold, withdraw and re-confirm, capture at most the hold, balanced ledger, capped auto refund, payouts net of commission and refunds, a second week after reset |
| `settlement.test.ts` | A failed void doesn't block other baskets; a second settlement run charges nobody twice |
| `secretary.test.ts` | Refund limits ($10, amount charged, already decided, 4th in 30 days, bad cents); one refund even if asked twice; escalation over $10; fact-only answers without a key |
| `negotiation.test.ts` | New-break rules; funded asks keep sheets valid and respect floors; repeated asks stop at the floor; captures stay within holds after lower prices |
| `trust.test.ts` | Prior, smoothing, recency, voided events, weights; trusted supplier beating a slightly cheaper one; much cheaper supplier winning at equal trust |
| `history.test.ts` | Three closed past weeks, paid suppliers, balanced ledger, different trust scores, keys restored |
| `restart.test.ts` | Mock PayPal rebuilt from the database so cutoff still captures after a restart |
| `tour.test.ts` | Every guided step in order, ending with a closed, balanced week |

`spikes/` holds standalone scripts that exercised the real sandbox before the app was built: hold, partial capture and refund; void; card decline; wallet hold; payout; Channel3.

## Guided demo

The demo bar's "next step" button runs one step at a time (`lib/engine/tour.ts`) and switches to the persona whose view shows the result.

| Step | Persona | What happens |
|---|---|---|
| 1 | Resident | Ananya's sample list is parsed into products |
| 2 | Captain | Collection closes; pools open for bids |
| 3 | Captain | Competing suppliers bid |
| 4 | Captain | Bidding closes; top-scored bids win |
| 5 | Resident | Ananya's PayPal hold is placed (sandbox test card, or mock) |
| 6 | Resident | 12 more flats place holds (repeats until 20 holds are in) |
| 7 | Captain | The Secretary asks suppliers for a better price on the money authorized |
| 8 | Resident | Cutoff: holds captured at the final price, the rest released |
| 9 | Resident | Ananya's receipt; the captain confirms delivery |
| 10 | Resident | Ananya reports a missing pack; the Secretary refunds or escalates |
| 11 | Supplier | The issue window closes and suppliers are paid out |
| 12 | Operator | The week in numbers: balanced ledger and analytics |

## Roadmap

1. Re-price a pool when a capture fails, before other baskets are charged.
2. Scheduled phase changes with an honor-period check.
3. Appeal screen for trust events, and resident reliability in refund limits.
4. Supplier no-shows and strikes.
5. Opt-in price-break nudges.
6. PayPal Multiparty for production.
