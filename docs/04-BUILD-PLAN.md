# PoolCart — 7-Day Build Plan, Demo Script and Submission Checklist

> Deadline: **Thu Nov 12 2026, 12:00 PT**. Target: everything submitted by **Wed Nov 11, 23:59 PT** so there's a buffer for YouTube processing and Devpost form issues.

## 0. Prize targeting (recap)

A project can win **1 grand or honorable-mention prize + 1 sponsor prize**.

- **Grand:** Best Use of Agentic Commerce · Most Impactful · Most Creative · Best Use of PayPal + AI · top 3
- **Sponsor:** AG Grid (primary) → Channel3 → APIMatic → Render (backups; we're considered for each tool we genuinely use)

## 1. Scope tiers

| Tier | Items |
|---|---|
| **MUST** (demo breaks without it) | Seeded society + persona switcher · Basket Assistant (text → lines, Channel3 match) · Pool Builder · seller bid form · Bid Analyst ranking · PayPal AUTHORIZE checkout (JS SDK v6) · settlement engine (partial capture / void) · live tier progress bar · handover + issue + partial refund · seller Payouts · AG Grid demand board + AG Studio operator dashboard · ledger · time-travel control · deployed on Render · README |
| **SHOULD** | Photo-of-list parsing (vision) · seller Subscriptions (Pro plan via PayPal Subscriptions) · webhooks with signature verification · Momentum Nudger · Insights agent in AG Studio (Studio Agent Framework) · crowd simulator with real sandbox card auths |
| **COULD** | Seller Pricing Copilot · Restock Autopilot (one-tap) · Bryntum Calendar for drop windows · voice input · email notifications |
| **WON'T (this hackathon)** | Multiparty, real KYC, taxes, native apps, multi-currency |

## 2. Day-by-day

| Day | Date | Goal | Done when |
|---|---|---|---|
| **D0** | Thu Nov 5 (tonight) | **De-risk spikes** (each ≤ 45 min) | ① Sandbox app created; a script does Orders AUTHORIZE → authorize → partial capture with `final_capture` → confirms the rest is released ② Void works ③ Payouts call succeeds in sandbox (Payouts enabled on the app) ④ Card `payment_source` auth works (decides the crowd-simulator mode) ⑤ Channel3 key works with promo credits ⑥ AG Studio trial license renders the boilerplate ⑦ Claude key works ⑧ Hello-world deploys on Render |
| **D1** | Fri Nov 6 | Skeleton | Next.js app from the AG Grid boilerplate · Drizzle schema + migrations · seed (Maple Heights, 40 households, 3 sellers, ~25 products) · persona switcher · `lib/paypal` client with request-id + retries |
| **D2** | Sat Nov 7 | Resident + AI intake | Basket Assistant (text + photo) with Channel3 matching · needs list · Pool Builder → AG Grid demand board for the captain |
| **D3** | Sun Nov 8 | Seller + bids | Seller portal: open pools, bid builder with tier editor, Bid Analyst ranking with "Why?" · captain approves winner · cycle state machine + time travel |
| **D4** | Mon Nov 9 | **Money core** | Commit phase: basket confirm → PayPal AUTHORIZE popup · live tier bar · settlement engine (dry run → capture/void) · ledger entries + "Ledger balanced" badge · engine unit tests (tiers, MOQ, capacity overflow, capture ≤ hold) |
| **D5** | Tue Nov 10 | Close the loop | Handover + packing list · issue report → Issue Resolver → partial refund · payouts with commission · webhooks · seller Pro subscription · AG Studio operator dashboard (savings, success rate, GMV, payouts) |
| **D6** | Wed Nov 11 | Polish + ship | Insights agent · UI polish, empty and error states · deploy on Render with seed · README + architecture diagram + test credentials · **record and upload the video by 18:00 PT** · submit the Devpost draft |
| **D7** | Thu Nov 12 (≤ 12:00 PT) | Buffer | Fix anything flagged; final submit by 09:00 PT |

**Cut rule:** if a day slips by more than half a day, drop the next SHOULD item, not a MUST.

## 3. Engine test cases (write these on D4; they double as judge-visible rigor)

1. Qty below MOQ → pool FAILED, all lines released, holds voided where the basket has no other won lines.
2. Qty crosses tier 2 → every line priced at tier 2; each resident captured < authorized.
3. Qty > capacity → overflow lines released first-committed-first-served, whole lines only.
4. Capture decline for one resident drops the pool below MOQ → nobody in that pool is charged.
5. Resident withdraws before cutoff → void; quantity drops; tier recalculated live.
6. Refund > line captured amount → rejected.
7. Payout retry reuses `sender_item_id` → no duplicate.
8. Ledger: Σdebits == Σcredits after a full cycle.
9. Schedule validator rejects commit-open → cutoff > 72h.

## 4. Demo video script (target 2:45)

| Time | Scene | What we show |
|---|---|---|
| 0:00–0:15 | Hook | "40 families in Maple Heights buy the same eggs, rice and oil every week, separately, at retail. Together they'd unlock wholesale prices. PoolCart is the AI that makes them buy together." |
| 0:15–0:40 | Resident | Snap a photo of a handwritten list → AI turns it into a basket matched to real products (Channel3), retail price shown |
| 0:40–1:00 | Captain | AG Grid demand board: AI-built pools ("Eggs ×38 dozen, Basmati 5kg ×14…") with demand estimates |
| 1:00–1:25 | Seller | Seller sees pooled demand (no personal data), Pricing Copilot suggests tiers, bids. Bid Analyst ranks bids and explains why |
| 1:25–1:55 | **Money moment** | Resident confirms → PayPal popup → hold of $41.20. Crowd simulator adds neighbours, the tier bar drops live. Cutoff → **captured $34.60**, rest released (show the PayPal sandbox transaction) |
| 1:55–2:15 | Delivery + issue | Handover checklist; resident reports a cracked egg tray with a photo → AI proposes a $3.10 refund → PayPal partial refund |
| 2:15–2:35 | Payout + business | Seller gets a PayPal payout net of 4% (Pro plan via PayPal Subscriptions). AG Studio dashboard: "Households saved 18% ($312) this week"; ask the Insights agent a question live |
| 2:35–2:45 | Close | "AI organizes the demand. PayPal holds, captures, refunds and pays out. Neighbours save, local sellers win." Stack logos |

## 5. Submission checklist

- [ ] Public GitHub repo, **MIT LICENSE** detected in the About sidebar
- [ ] README: problem, demo URL, persona logins, sandbox buyer test account(s), how to run locally (`docker compose up` + `npm run dev`), env vars, architecture diagram, **"Tools used" section** (Claude Sonnet/Haiku 5.5, PayPal APIs list, AG Grid/AG Studio, Channel3, Render, APIMatic Context Plugin, PayPal AI Toolkit)
- [ ] No secrets committed (`.env.example` only); demo keys rate-limited
- [ ] Hosted demo on Render works from a fresh browser
- [ ] YouTube video < 3:00, public, no copyrighted music, PayPal + AI visible end-to-end
- [ ] Devpost: description, "Built With" tags, video link, repo link, demo URL, test credentials
- [ ] Mention sponsor tools explicitly in the description (to be considered for sponsor prizes)
- [ ] Claim the APIMatic free subscription form (used the Context Plugin)

## 6. Day-0 risks and fallbacks

| Risk | Fallback |
|---|---|
| Payouts not enabled in sandbox app | Request enablement in the dashboard / Discord. Meanwhile, ledger-only "pending payout" with an explicit badge |
| Partial capture with `final_capture` behaves differently | Capture the final amount, then explicitly void the authorization if it's still active |
| Card `payment_source` not enabled | Crowd simulator uses `simulated=true` baskets (Architecture §14) |
| AG Studio license or agent framework friction | Plain AG Grid + AG Charts dashboard (still qualifies for "any AG Grid tools") |
| Channel3 has no match for a grocery item | Manual product create with operator-entered retail reference; pool still works |
| Render cold start during judging | Paid starter instance for the judging period (Render credits) |
