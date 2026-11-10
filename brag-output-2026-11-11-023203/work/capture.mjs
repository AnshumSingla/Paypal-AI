// Render ../composition/index.html frame by frame through headless Chrome (DevTools protocol).
// node capture.mjs            -> frames/ + sfx.json (sound cues from the page)
// node capture.mjs 1.2 7.5    -> stills/ at those seconds
// node capture.mjs check      -> layout check: any text overflowing its box or the frame, at many times
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336, FPS = 30;
const args = process.argv.slice(2);
const profile = join(here, "chrome-profile");
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1920,1080", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, (d) => (d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result))); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url: pathToFileURL(join(here, "..", "composition", "index.html")).href });
for (let i = 0; i < 100 && (await evaluate("document.readyState").catch(() => "")) !== "complete"; i++) await sleep(100);
console.log("Geist loaded:", await evaluate("document.fonts.ready.then(() => document.fonts.check('600 40px Geist'))"));
const total = await evaluate("window.TOTAL");
const at = (t) => evaluate(`window.renderAt(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
async function shot(t, file) { await at(t); const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 }); writeFileSync(file, Buffer.from(data, "base64")); }

if (args[0] === "check") {
  const problems = new Set();
  for (let t = 0.2; t < total; t += 0.3) {
    await at(t);
    const found = await evaluate(`[...document.querySelectorAll('.scene')].filter(s => +s.style.opacity > 0.5).flatMap(s => [...s.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim()).flatMap(e => { const r = e.getBoundingClientRect(); const out = []; if (r.right > 1920 || r.left < 0 || r.bottom > 1080 || r.top < 0) out.push('off-frame: ' + e.textContent.trim().slice(0, 40)); if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') out.push('clipped: ' + e.textContent.trim().slice(0, 40)); return out; }))`);
    found.forEach((p) => problems.add(p));
  }
  console.log(problems.size ? [...problems].join("\n") : "layout check: no text off-frame or clipped");
} else if (args.length) {
  mkdirSync(join(here, "stills"), { recursive: true });
  for (const t of args.map(Number)) await shot(t, join(here, "stills", `t${t.toFixed(2)}.jpg`));
  console.log("stills done");
} else {
  writeFileSync(join(here, "sfx.json"), JSON.stringify(await evaluate("window.SFX"), null, 1));
  const dir = join(here, "frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = Math.round(total * FPS);
  for (let f = 0; f < n; f++) await shot(f / FPS, join(dir, `f${String(f).padStart(5, "0")}.jpg`));
  console.log(`frames done: ${n} (${total}s)`);
}
ws.close();
chrome.kill();
process.exit(0);
