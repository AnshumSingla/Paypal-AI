# Composition brief: Collective

## Objective
A short launch film for Collective, built from this project and from one real PayPal sandbox run.

## Output
- Composition: `composition/index.html` (every frame is `window.renderAt(t)`, a pure function of time)
- Rendered video: `brag.mp4`, poster `brag.jpg`
- Landscape 1920x1080, 30 fps, 28.8 s

## How it was built
The full /brag workflow hands this step to Hyperframes, but neither its skills nor its CLI are installed on this machine. The composition follows the same contract (one page, time-driven, local assets) and is rendered by `work/capture.mjs` through headless Chrome, then muxed with ffmpeg. In place of `hyperframes check`, `node work/capture.mjs check` samples every 0.3 s and fails on any text that leaves the frame or is clipped; stills of every scene and of mid-transitions were reviewed by eye.

## Source material
- Project: D:\Paypal-AI (app/page landing copy, app/globals.css tokens, app/layout.tsx fonts, lib/engine/tour.ts copy, README problem statement)
- Real data: the sandbox run listed at the end of brag-plan.md
- Copy used verbatim or trimmed from the project: "Buy together. Pay less.", "Each flat approves one PayPal hold.", "Prices can only go down.", "You approved a hold for the maximum", "PayPal charged the price the building unlocked", "The rest of the hold went back to you", "Approve the max. Pay what the building unlocked."

## Creative direction
Polished; a quiet, exact product film that reads like a well-made receipt. Hook: forty flats light up while the problem line types out. Outro: the product's own promise.

## Visual identity
Black #000, surfaces #0a0a0a, borders #1f1f1f/#2e2e2e, text #f5f5f5, muted #a3a3a3, PayPal blue #3d9bff, the landing hero gradient once. Geist and Geist Mono.

## Audio
No music, at the user's request. Keystrokes (Kenney, CC0) on every second typed character, one mouse click when the PayPal hold is approved. Cue times come from the page itself (`window.SFX`) so sound and picture share one schedule; `../brag-output/demo/sfx.mjs` mixes them.
