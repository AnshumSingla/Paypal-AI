// Drive the real app through the guided tour in headless Chrome and screenshot every step.
// Usage: node shoot.mjs [baseUrl]   (default http://localhost:3200) -> shots/*.jpg + shots.json
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://localhost:3200";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const W = 1600;
const H = 900;
const out = join(here, "shots");
// "views" as the second argument retakes only the closing views (receipt, ops, analytics) after the tour.
const VIEWS_ONLY = process.argv[3] === "views";
if (!VIEWS_ONLY) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const profile = join(here, "chrome-profile");
rmSync(profile, { recursive: true, force: true });

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (d) => (d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1.2, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); // the spotlight lands at once
await send("Page.enable");

const shots = VIEWS_ONLY ? JSON.parse(readFileSync(join(here, "shots.json"), "utf8")).filter((x) => /step-/.test(x.file) || /landing/.test(x.file)) : [];
let k = shots.length;
async function shot(name, caption) {
  await sleep(700);
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
  const file = `${String(++k).padStart(2, "0")}-${name}.jpg`;
  writeFileSync(join(out, file), Buffer.from(data, "base64"));
  shots.push({ file, caption });
  console.log(file, "|", caption);
}
async function go(url) {
  await send("Page.navigate", { url: BASE + url });
  for (let i = 0; i < 100 && (await js("document.readyState").catch(() => "")) !== "complete"; i++) await sleep(150);
  await sleep(1200);
}
const clickText = (label) =>
  js(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const state = () => js(`(() => { const d = document.querySelector('[role=dialog][aria-label^="Guided tour"]'); const m = d?.querySelector("p.rounded-lg"); return JSON.stringify({ step: d?.getAttribute("aria-label") ?? "", msg: m?.textContent ?? "", path: location.pathname, busy: !!d?.querySelector("button[disabled]") }); })()`).then(JSON.parse);
const card = () => js(`(() => { const d = document.querySelector('[role=dialog][aria-label^="Guided tour"]'); return d ? { title: d.querySelector("h2")?.textContent ?? "", msg: d.querySelector("p.rounded-lg")?.textContent ?? "", step: d.getAttribute("aria-label"), busy: d.textContent.includes("Running it for real") } : null; })()`);
async function waitChange(before) {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const s = await state().catch(() => null);
    if (s && !s.busy && (s.step !== before.step || s.msg !== before.msg || s.path !== before.path)) {
      await sleep(1500);
      return;
    }
  }
  throw new Error("step did not finish");
}

// Landing page, then start the tour from a clean week.
if (!VIEWS_ONLY) {
await go("/");
await shot("landing", "Buy together. Pay less.");
if (!(await clickText("Start over")) && !(await clickText("Take the guided tour"))) throw new Error("no tour button on the landing page");
for (let i = 0; i < 480 && !(await card()); i++) await sleep(500);
if (!(await card())) throw new Error("the tour card never appeared after Start over");

const CHOICES = { "Neighbours join, prices drop": ["12 flats confirm, one card is declined", "12 flats confirm"], "Something was missing": ["A whole item over $10 was missing"], "The captain decides": ["Approve the refund"] };
const used = {};
for (let guard = 0; guard < 20; guard++) {
  // The card's message updates before the page refresh brings the next step, so wait until it settles.
  let c = await card();
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    const again = await card();
    if (again?.title === c?.title && again?.msg === c?.msg && !again?.busy) break;
    c = again;
  }
  if (!c) break;
  await shot(`step-${c.title.toLowerCase().replace(/[^a-z]+/g, "-")}`, `${c.title}${c.msg ? `|${c.msg}` : ""}`);
  if (c.title === "The week in numbers") break;
  const options = CHOICES[c.title];
  const before = await state();
  if (options) {
    const pick = options[Math.min(used[c.title] ?? 0, options.length - 1)];
    used[c.title] = (used[c.title] ?? 0) + 1;
    if (!(await clickText(pick))) throw new Error(`no choice ${pick}`);
  } else {
    // Run the step (or open the right person's view first).
    const ok = await js(`(() => { const d = document.querySelector('[role=dialog][aria-label^="Guided tour"]'); const b = [...d.querySelectorAll("button.btn-primary")].pop(); if (!b) return false; b.click(); return true; })()`);
    if (!ok) throw new Error(`no primary button on "${c.title}"`);
  }
  await waitChange(before);
}
}

// A few clean views without the tour card.
await go("/"); // sessionStorage belongs to the app's origin, so be on it first
await js(`sessionStorage.setItem("tour:hidden", "1")`);
for (const [persona, url, name, caption] of [
  ["Resident", "/resident", "receipt", "Ananya's receipt: approved, charged, refunded, with PayPal IDs"],
  ["Operator", "/ops", "ops", "The operator's console: revenue, fees, payouts, a ledger that balances"],
  ["Operator", "/ops/dashboard", "analytics", "AG Studio analytics, with an AI analyst"],
]) {
  await go("/");
  await js(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(${JSON.stringify(persona)}) && x.textContent.includes("Open view")); b?.click(); })()`);
  await sleep(2500);
  await go(url);
  await sleep(1500);
  await shot(name, caption);
}

writeFileSync(join(here, "shots.json"), JSON.stringify(shots, null, 2));
ws.close();
chrome.kill();
process.exit(0);
