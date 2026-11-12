# What's left before submitting

Deadline: **Fri 13 Nov 2026, 01:30 IST** (Thu 12 Nov, 12:00 PT). Aim to submit by **Thu 12 Nov, 20:00 IST**.

## Done

- [x] Product: four roles, a guided tour with choices at the edge cases, the AI Secretary on Gemini with Groq as fallback
- [x] Real PayPal sandbox: holds, partial final capture, void, decline, refund, Payouts, Subscriptions ([spike results](../spikes/RESULTS.md), `npm run sandbox:week`)
- [x] CI green on `main`: lint, types, tests, build
- [x] README with screenshots, sponsors table, Deploy to Render button, Postman collection
- [x] Sandbox business account topped up to 99,999 USD (each tour pays suppliers about $820, so about 120 tours)
- [x] Both videos recorded from one real sandbox run on 11 Nov, no music, keystroke sounds only: the 2-minute tour `brag-output/demo.mp4` and the 29-second launch film `brag-output-2026-11-11-023203/brag.mp4`
- [x] Full tour on the real sandbox, every step reviewed from screenshots; fixes from that review are in (AI text shows no internal IDs and writes dollars, clearer minimum-order and cutoff wording, analytics money in dollars, favicon and link preview in the current colours)
- [x] Channel3 key in local `.env`; search checked live, and results that aren't the same product are rejected ([spike results](../spikes/RESULTS.md))

## Must do (the submission is incomplete without these)

- [x] **Deploy on Render (free plan, no card needed).** Use the Deploy to Render button in the README, or New > Blueprint with this repo. Render needs access to the repo: while it is private, connect the GitHub account that owns it (Anshum's), or make it public first. Create a free Postgres on neon.com (no card) and paste its connection string as `DATABASE_URL`. When Render prompts for secrets, enter the same values as your local `.env`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX_PERSONAL_EMAIL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CHANNEL3_API_KEY`. Leave the others blank for now.
- [x] **Check the deploy.** `https://collective-mxtv.onrender.com/api/health` should return `{"ok":true,"paypal":"sandbox"}`. Then complete the guided tour once from a private window. Every visitor shares one demo week, so if two people tour at once they can move each other's steps. The testing notes tell judges to press Start over if that happens.
- [ ] **Add the PayPal webhook.** In developer.paypal.com, open Apps & Credentials, then the **Collective US** app, then Add Webhook. Use the URL `https://collective-mxtv.onrender.com/api/webhooks/paypal` and select all payment events. Copy the Webhook ID into Render as `PAYPAL_WEBHOOK_ID` and redeploy.
- [x] **Make the repo public.** Anshum does this: GitHub, Settings, Danger zone, Change visibility.
- [ ] **Upload the video to YouTube** as public or unlisted: `brag-output/demo.mp4` (2 minutes, the one judges need), or your narrated version. The 29-second launch film is for social posts and the README.
- [ ] **Fill the blank in [SUBMISSION.md](SUBMISSION.md):** the YouTube URL. Judges approve holds with the sandbox test card button, so no PayPal login is shared.
- [ ] **Submit on Devpost.** Paste the text from SUBMISSION.md, add both team members, tick the sponsor prizes (AG Grid, plus any others the form lists that we use), and attach the links.

## Should do (each one raises the score)

- [ ] **Narrate the video.** Your own voice over `brag-output/demo.mp4` (it has no music, so a voice sits on top cleanly); the script is in [SUBMISSION.md](SUBMISSION.md). Judges may score from the video alone.
- [ ] **Add evidence from a real building.** Collect real grocery lists from 10 to 15 households, and I'll turn them into the README's "Evidence from a real building" section with the measured saving.

## Housekeeping

- [ ] **Rotate the secrets** that were pasted in chat on 10 Nov from the PaperMind `.env` (the Supabase keys and the JWT secret). This is a different project, but the values are no longer private.
- [ ] **Keep the Render service running until 15 Dec**, when judging ends. It is on the free plan: it sleeps after 15 minutes without visitors and wakes in about a minute. The Neon database sleeps too and keeps its data.
- [ ] **Optional:** an AG Studio licence as `AG_STUDIO_LICENSE`. Without it, the analytics page shows a trial watermark.
