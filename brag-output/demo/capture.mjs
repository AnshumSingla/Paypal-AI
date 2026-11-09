// Render video.html frame by frame through headless Chrome (DevTools protocol, no installs).
// Usage: node capture.mjs            -> all frames into frames/
//        node capture.mjs 1.2 7.5    -> stills at those seconds into stills/
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
const FPS = 30;
const stills = process.argv.slice(2).map(Number);

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(here, "chrome-profile")}`, "--hide-scrollbars", "--window-size=1920,1080", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, (d) => (d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result))); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url: pathToFileURL(join(here, "video.html")).href });
for (let i = 0; i < 100 && (await evaluate("document.readyState").catch(() => "")) !== "complete"; i++) await sleep(100);
await evaluate("document.fonts.ready.then(() => document.fonts.check('600 40px Geist'))").then((ok) => console.log("Geist loaded:", ok));
const total = await evaluate("window.TOTAL");

async function shot(t, file) {
  await evaluate(`window.renderAt(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
  writeFileSync(file, Buffer.from(data, "base64"));
}

if (stills.length) {
  mkdirSync(join(here, "stills"), { recursive: true });
  for (const t of stills) await shot(t, join(here, "stills", `t${t.toFixed(2)}.jpg`));
  console.log("stills done");
} else {
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
