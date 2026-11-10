# What's left before submitting

Deadline: **Fri 13 Nov 2026, 01:30 IST** (Thu 12 Nov, 12:00 PT). Aim to submit by **Thu 12 Nov, 20:00 IST**.

## Done

- [x] Product: four roles, a guided tour with choices at the edge cases, the AI Secretary on Gemini with Groq as fallback
- [x] Real PayPal sandbox: holds, partial final capture, void, decline, refund, Payouts, Subscriptions ([spike results](../spikes/RESULTS.md), `npm run sandbox:week`)
- [x] CI green on `main`: lint, types, tests, build
- [x] README with screenshots, sponsors table, Deploy to Render button, Postman collection
- [x] Two-minute demo video of the whole tour: `brag-output/demo.mp4` (recorded on the stand-in on 10 Nov; re-recorded on the sandbox below)
- [x] Channel3 key in local `.env`; search checked live, and results that aren't the same product are rejected ([spike results](../spikes/RESULTS.md))

## Must do (the submission is incomplete without these)

- [ ] **Give the sandbox business account a large balance.** Each guided tour pays suppliers about $800 through Payouts, and the "Collective US" account ran out (`INSUFFICIENT_FUNDS`) after a few test runs. Without a big balance, payouts fail for judges after a handful of tours. In developer.paypal.com, go to Testing Tools > Sandbox Accounts > Create account, choose Business and United States, and set a PayPal balance of 9,999,999 USD. Then create an app on that account (Apps & Credentials > Create App) and put its Client ID and Secret into `.env` and Render.

- [ ] **Re-record the video on the sandbox** (I do this, about 15 minutes). The shoot was ready, but the payout step failed with `INSUFFICIENT_FUNDS`, so it waits on the large-balance account above.
- [ ] **Deploy on Render.** Use the Deploy to Render button in the README, or New > Blueprint with this repo. When Render prompts for secrets, enter the same values as your local `.env`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX_PERSONAL_EMAIL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CHANNEL3_API_KEY`. Leave the others blank for now.
- [ ] **Check the deploy.** `https://<service>.onrender.com/api/health` should return `{"ok":true,"paypal":"sandbox"}`. Then complete the guided tour once from a private window. Every visitor shares one demo week, so if two people tour at once they can move each other's steps. The testing notes tell judges to press Start over if that happens.
- [ ] **Add the PayPal webhook.** In developer.paypal.com, open Apps & Credentials, then the **Collective US** app, then Add Webhook. Use the URL `https://<service>.onrender.com/api/webhooks/paypal` and select all payment events. Copy the Webhook ID into Render as `PAYPAL_WEBHOOK_ID` and redeploy.
- [ ] **Make the repo public.** Anshum does this: GitHub, Settings, Danger zone, Change visibility.
- [ ] **Upload the video to YouTube** as public or unlisted (`brag-output/demo.mp4`, or your narrated version).
- [ ] **Fill the three blanks in [SUBMISSION.md](SUBMISSION.md):** the Render URL, the YouTube URL, and the sandbox personal login for judges. The login is on developer.paypal.com under Testing Tools, Sandbox Accounts, then the personal account's View/edit page. It's a sandbox-only account, but sharing it is your decision.
- [ ] **Submit on Devpost.** Paste the text from SUBMISSION.md, add both team members, tick the sponsor prizes (AG Grid, plus any others the form lists that we use), and attach the links.

## Should do (each one raises the score)

- [ ] **Narrate the video.** Your own voice over `brag-output/demo.mp4`; the tour's card titles work as a script. Judges may score from the video alone.
- [ ] **Add evidence from a real building.** Collect real grocery lists from 10 to 15 households, and I'll turn them into the README's "Evidence from a real building" section with the measured saving.

## Housekeeping

- [ ] **Rotate the secrets** that were pasted in chat on 10 Nov from the PaperMind `.env` (the Supabase keys and the JWT secret). This is a different project, but the values are no longer private.
- [ ] **Keep Render paid and running until 15 Dec**, when judging ends.
- [ ] **Optional:** an AG Studio licence as `AG_STUDIO_LICENSE`. Without it, the analytics page shows a trial watermark.
