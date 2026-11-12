# How to submit Collective on Devpost

For the teammate who submits. You don't need the code or any setup: everything is on this GitHub page or on the live site. It takes about 30 minutes.

**Deadline: Fri 13 Nov 2026, 01:30 IST** (Thu 12 Nov, 12:00 noon Pacific). Don't leave it to the last hour: Devpost and YouTube both get slow near a deadline.

All the text you paste comes from one file: **[docs/SUBMISSION.md](docs/SUBMISSION.md)**. Keep it open in a second tab.

## Step 1. Check the live demo works (3 minutes)

1. Open https://collective-mxtv.onrender.com/api/health
   - The first visit can take about a minute while the free server wakes up. Wait for it.
   - It should show `{"ok":true,"paypal":"sandbox"}`. If it doesn't after two minutes, message your teammate before submitting.
2. Open https://collective-mxtv.onrender.com and press **Take the guided tour**. Click through two or three steps to see it works. (If you see **Continue the tour** instead, press **Start over** first.)

## Step 2. Download the demo video (1 minute)

1. Open https://github.com/AnshumSingla/Paypal-AI/blob/main/brag-output/demo.mp4
2. Click the **Download raw file** button (the down-arrow icon at the top right of the file). You get `demo.mp4` (about 33 MB, 2 minutes).
3. Also download the thumbnail: https://github.com/AnshumSingla/Paypal-AI/blob/main/brag-output/demo.jpg (same download button).

## Step 3. Upload the video to YouTube (10 minutes)

1. Go to https://studio.youtube.com, sign in, and click **Create**, then **Upload videos**. Choose `demo.mp4`.
2. **Title:** copy it from [docs/SUBMISSION.md](docs/SUBMISSION.md#5-demo-video), under "YouTube title".
3. **Description:** copy it from the same section, under "YouTube description".
4. **Thumbnail:** upload `demo.jpg`.
5. **Audience:** choose "No, it's not made for kids".
6. **Visibility: Public.** This is required: not Unlisted, not Private.
7. Click **Publish** and copy the video link (it looks like `https://youtu.be/...`).
8. Check it: open the link in a private/incognito window. It must play without signing in.

## Step 4. Fill in the Devpost form (15 minutes)

Open the PayPal AI Hackathon on Devpost and click **Enter a submission**. If a draft already exists, open it from **My projects** instead.

Copy each field from [docs/SUBMISSION.md](docs/SUBMISSION.md):

| Devpost field | What to paste | Where it is in SUBMISSION.md |
|---|---|---|
| Project name | `Collective` | "Devpost fields" |
| Tagline / elevator pitch | The tagline | "Devpost fields" |
| About the project (the story) | Everything under **1. Text description**, from "Inspiration" to "Honest limits" | Section 1 |
| Built with | The comma-separated list | "Devpost fields", "Built with" |
| Try it out links | `https://collective-mxtv.onrender.com` and `https://github.com/AnshumSingla/Paypal-AI` | "Links" |
| Video demo link | Your YouTube link from Step 3 | |
| Testing instructions (if the form asks) | The numbered list under "Testing instructions" | Section 2 |
| Tools / AI used (if the form asks) | Section 3 | Section 3 |
| Image gallery | Download and upload the five screenshots: [landing](docs/screenshots/landing.jpg), [tour](docs/screenshots/tour-choices.jpg), [receipt](docs/screenshots/receipt.jpg), [captain](docs/screenshots/captain-decides.jpg), [analytics](docs/screenshots/analytics.jpg) | |

Then:

1. **Team:** add every teammate as a member of the project (they get an email invite and must accept it).
2. **Prizes:** tick the main prize, **Best Use of Agentic Commerce** if it's listed, and **AG Grid** (we use AG Grid and AG Studio). Tick any other sponsor prize whose tool the "Built with" list includes (for example Render).
3. If the form asks for the code licence: **MIT**. It's in the [LICENSE](LICENSE) file.

## Step 5. Final checks, then Submit (2 minutes)

- [ ] The YouTube video is **Public** and plays in a private window.
- [ ] The live demo link opens (allow a minute) and the health link shows `"ok":true`.
- [ ] The GitHub link opens without signing in, and the page shows "MIT license" in the About box on the right.
- [ ] All teammates are added on Devpost.
- [ ] Press **Submit**. Devpost shows a confirmation and the project page says "Submitted". Take a screenshot of it and send it to the team.

## If something goes wrong

- **The live demo shows an error page, or a tour step doesn't match:** press **Start over** on the home page. Another judge or teammate may be using it at the same time.
- **The live demo doesn't load at all after two minutes:** submit anyway (the video and GitHub link are enough to judge), and message your teammate so they can check the Render dashboard.
- **YouTube is still processing:** the link works as soon as you publish. You can submit while it finishes processing.
- **Don't change anything on GitHub, Render or Neon.** None of those are needed to submit.
