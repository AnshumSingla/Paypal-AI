// Synthesised soundtrack: 100 BPM, C major, everything on one beat grid from frame 0.
// Pad + bass + soft kick/hats + a pluck in key on each scene cut. Writes music.wav (48 kHz stereo).
import { readFileSync, writeFileSync } from "node:fs";
const SC = JSON.parse(readFileSync(new URL("./scenes.json", import.meta.url), "utf8"));

const SR = 48000, BPM = 100, BEAT = 60 / BPM, TOTAL = SC.beats * BEAT + 1.2; // tail for the last chord
const N = Math.ceil(TOTAL * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };

// Chords per bar (4 beats): Cmaj7, Am7, Fmaj7, G6 (MIDI notes)
const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 52, 59]];
const bars = Math.ceil(SC.beats / 4);

// Pad: detuned triangles, slow attack, gentle low-pass
for (let b = 0; b < bars; b++) {
  const start = b * 4 * BEAT, len = 4 * BEAT + 0.4, ch = CHORDS[b % 4];
  const s0 = Math.floor(start * SR), n = Math.floor(len * SR);
  let lpL = 0, lpR = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR, env = Math.min(1, t / 0.5) * Math.min(1, (len - t) / 0.5);
    let vl = 0, vr = 0;
    for (const m of ch) {
      const f = hz(m + 12);
      const tri = (x) => 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1;
      vl += tri(f * 1.002 * t); vr += tri(f * 0.998 * t);
    }
    lpL += 0.08 * (vl - lpL); lpR += 0.08 * (vr - lpR);
    add(s0 + k, lpL * env * 0.035, lpR * env * 0.035);
  }
}

// Bass: root on beats 1 and 3, round sine with a little second harmonic
for (let beat = 0; beat < SC.beats; beat += 2) {
  const root = CHORDS[Math.floor(beat / 4) % 4][0] - 12, f = hz(root);
  const s0 = Math.floor(beat * BEAT * SR), n = Math.floor(BEAT * 1.8 * SR);
  for (let k = 0; k < n; k++) { const t = k / SR, env = Math.min(1, t / 0.01) * Math.exp(-t * 2.2); const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * env * 0.16; add(s0 + k, v); }
}

// Kick on 1 and 3 (soft), hats on off-beats (quiet), from bar 2 so the hook breathes
for (let beat = 4; beat < SC.beats; beat++) {
  const s0 = Math.floor(beat * BEAT * SR);
  if (beat % 2 === 0) for (let k = 0; k < 0.35 * SR; k++) { const t = k / SR; const f = 50 + 70 * Math.exp(-t * 30); add(s0 + k, Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.22); }
  let seed = beat * 9973;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const h0 = s0 + Math.floor((BEAT / 2) * SR);
  let prev = 0;
  for (let k = 0; k < 0.06 * SR; k++) { const x = rnd(); const hp = x - prev; prev = x; add(h0 + k, hp * Math.exp(-(k / SR) * 70) * 0.025, hp * Math.exp(-(k / SR) * 70) * 0.03); }
}

// Pluck on each scene cut (beats 6, 11, 19, 27, 33): soft bell in key, panned slightly
const CUTS = SC.cuts.slice(1), PLUCK = CUTS.map((_, i) => [72, 76, 79, 76, 84, 79][i % 6]);
CUTS.forEach((beat, i) => {
  const s0 = Math.floor(beat * BEAT * SR), f = hz(PLUCK[i]);
  for (let k = 0; k < 1.2 * SR; k++) { const t = k / SR; const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.01 * t)) * Math.exp(-t * 4) * Math.min(1, t / 0.004) * 0.07; add(s0 + k, v * 0.8, v); }
});

// Final fade and normalise to about -3 dBFS
const fadeFrom = Math.floor((TOTAL - 1.0) * SR);
for (let i = fadeFrom; i < N; i++) { const g = 1 - (i - fadeFrom) / (N - fadeFrom); L[i] *= g; R[i] *= g; }
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const gain = 0.7 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4); }
writeFileSync(new URL("./music.wav", import.meta.url), buf);
console.log(`music.wav ${TOTAL.toFixed(2)}s, peak gain ${gain.toFixed(2)}`);
