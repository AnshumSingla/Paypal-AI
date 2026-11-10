// Mix keystroke and click sounds (Kenney, CC0) at the times in a sfx JSON into a 48 kHz stereo WAV.
// No music. Usage: node sfx.mjs [sfx.json] [out.wav]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [inFile = join(here, "sfx.json"), outFile = join(here, "sfx.wav")] = process.argv.slice(2);
const { total, events } = JSON.parse(readFileSync(inFile, "utf8"));
const SR = 48000;

// Read a mono 16-bit PCM WAV and resample it to 48 kHz (linear).
function load(file) {
  const b = readFileSync(file);
  let o = 12, rate = 44100, data = null;
  while (o < b.length) {
    const id = b.toString("ascii", o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === "fmt ") rate = b.readUInt32LE(o + 12);
    if (id === "data") data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  const src = new Float32Array(data.length / 2).map((_, i) => data.readInt16LE(i * 2) / 32768);
  const n = Math.floor((src.length * SR) / rate);
  return Float32Array.from({ length: n }, (_, i) => { const x = (i * rate) / SR, j = Math.floor(x), f = x - j; return (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f; });
}
const dir = join(here, "sfx");
const keys = readdirSync(dir).filter((f) => f.startsWith("key-")).map((f) => load(join(dir, f)));
const click = load(join(dir, "click.wav"));

const N = Math.ceil((total + 0.5) * SR);
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const e of events) {
  const s = e.kind === "click" ? click : keys[Math.floor(rnd() * keys.length)];
  const g = e.kind === "click" ? 0.45 : 0.32 * (0.8 + 0.4 * rnd()); // keys vary a little, like a real hand
  const pan = e.kind === "click" ? 0 : (rnd() - 0.5) * 0.3;
  const s0 = Math.round(e.t * SR);
  for (let k = 0; k < s.length && s0 + k < N; k++) { L[s0 + k] += s[k] * g * (1 - pan); R[s0 + k] += s[k] * g * (1 + pan); }
}
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
let peak = 0;
for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
writeFileSync(outFile, buf);
console.log(`${outFile}: ${events.length} sounds, ${(N / SR).toFixed(1)}s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
