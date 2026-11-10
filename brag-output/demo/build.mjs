// Build the demo video page from the real screenshots: writes video.html (renderAt(t), window.TOTAL)
// and scenes.json (the scene schedule) plus sfx.json (keystroke and click times, mixed by sfx.mjs). Every scene length is a whole number of
// beats at 100 BPM, so cuts land on the beat.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BEAT = 0.6;
const shots = JSON.parse(readFileSync(join(here, "shots.json"), "utf8"));
const clip = (s, n = 170) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s);

const scenes = [
  { kind: "title", beats: 7 },
  { kind: "text", beats: 9, eyebrow: "The problem", big: "Forty flats buy the same rice, dal and eggs.", small: "One by one, at retail. A volunteer collects lists, chases payments and fronts the money." },
  { kind: "text", beats: 10, eyebrow: "The idea", big: "One PayPal hold per flat. An AI Secretary that negotiates.", small: "PayPal charges only the price the whole building unlocked. The rest of every hold goes back." },
];
let stepNo = 0;
for (const s of shots) {
  const [title, msg = ""] = s.caption.split("|");
  if (s.file.includes("-step-")) stepNo++;
  scenes.push({ kind: "shot", beats: s.file.includes("-step-") ? 9 : 7, img: `shots/${s.file}`, label: s.file.includes("-step-") ? "Guided tour" : s.file.includes("landing") ? "Collective" : "After the week", title, msg: clip(msg) });
}
scenes.push(
  { kind: "stack", beats: 11 },
  { kind: "outro", beats: 9 },
);
let beat = 0;
for (const s of scenes) {
  s.startBeat = beat;
  s.start = +(beat * BEAT).toFixed(3);
  beat += s.beats;
  s.end = +(beat * BEAT).toFixed(3);
}
const TOTAL = +(beat * BEAT + 1.2).toFixed(3);
// Typed text: titles type out one character every CHAR seconds, with a keystroke each (sfx.json, mixed by sfx.mjs).
const CHAR = 0.032;
const events = [];
for (const s of scenes) {
  const typed = s.kind === "shot" ? s.title : s.kind === "text" ? s.big : null;
  if (!typed) continue;
  s.typeAt = +(s.start + (s.kind === "shot" ? 0.45 : 0.3)).toFixed(3);
  if (s.kind === "shot" && s.label === "Guided tour") events.push({ t: +(s.start + 0.12).toFixed(3), kind: "click" });
  [...typed].forEach((ch, i) => { if (ch !== " " && i % 2 === 0) events.push({ t: +(s.typeAt + i * CHAR).toFixed(3), kind: "key" }); }); // every other character, so it sounds like typing, not a rattle
}
writeFileSync(join(here, "sfx.json"), JSON.stringify({ total: TOTAL, events }, null, 1));
writeFileSync(join(here, "scenes.json"), JSON.stringify({ beats: beat, total: TOTAL, cuts: scenes.map((s) => s.startBeat) }, null, 2));

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
html,body{width:1920px;height:1080px;background:#000;overflow:hidden;font-family:Geist,system-ui,sans-serif;color:#f5f5f5}
.scene{position:absolute;inset:0;opacity:0}
.mono{font-family:"Geist Mono",monospace}
.brand{color:#3d9bff}
.center{display:flex;flex-direction:column;justify-content:center;padding:0 200px}
.eyebrow{font-size:30px;font-weight:600;color:#3d9bff}
.big{font-size:84px;font-weight:650;letter-spacing:-0.04em;line-height:1.04;margin-top:22px;max-width:1450px}
.small{font-size:36px;color:#a3a3a3;line-height:1.4;margin-top:30px;max-width:1300px}
.frame{position:absolute;left:222px;top:222px;width:1476px;height:830px;border-radius:22px;overflow:hidden;border:1px solid #2e2e2e;box-shadow:0 40px 120px -30px rgba(61,155,255,.35)}
.frame img{width:100%;height:100%;object-fit:cover;transform-origin:60% 40%}
.cap{position:absolute;left:222px;top:42px;width:1476px;display:grid;grid-template-columns:auto 1fr;column-gap:28px;align-items:baseline}
.cap .lab{font-size:22px;color:#737373;grid-column:1/3}
.cap .t{font-size:46px;font-weight:650;letter-spacing:-0.03em;margin-top:4px;white-space:nowrap}
.cap .m{font-size:25px;color:#5cc8ff;line-height:1.35;align-self:end;padding-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(3,26px);gap:9px}
.grid i{width:26px;height:26px;border-radius:6px;background:#3d9bff;display:block}
.chips{display:flex;flex-wrap:wrap;gap:16px;margin-top:40px;max-width:1500px}
.chip{font-size:30px;padding:12px 24px;border-radius:999px;border:1px solid #2e2e2e;background:#0a0a0a}
.chip b{color:#3d9bff;font-weight:600}
</style></head><body>
<div id="root"></div>
<script>
const S=${JSON.stringify(scenes)};
window.TOTAL=${TOTAL};
const root=document.getElementById('root');
const logo=(n)=>'<div class="grid">'+Array.from({length:9},(_,i)=>'<i style="opacity:'+([0,2,3,4,5,7,8].includes(i)?1:.3)+'"></i>').join('')+'</div>';
S.forEach((s,i)=>{const d=document.createElement('div');d.className='scene';d.id='s'+i;
if(s.kind==='title')d.innerHTML='<div class="center" style="height:100%;align-items:flex-start">'+logo()+'<div class="big" style="font-size:150px;margin-top:40px">Collective</div><div class="small" style="font-size:44px;color:#f5f5f5">Buy together. <span class="brand">Pay less.</span></div><div class="small mono" style="font-size:26px;margin-top:50px;color:#737373">PayPal AI Hackathon, agentic commerce</div></div>';
if(s.kind==='text')d.innerHTML='<div class="center" style="height:100%"><div class="eyebrow">'+s.eyebrow+'</div><div class="big typed"></div><div class="small">'+s.small+'</div></div>';
if(s.kind==='shot')d.innerHTML='<div class="frame"><img src="'+s.img+'"></div><div class="cap"><div class="lab mono">'+s.label+'</div><div class="t typed"></div>'+(s.msg?'<div class="m">'+s.msg+'</div>':'')+'</div>';
if(s.kind==='stack')d.innerHTML='<div class="center" style="height:100%"><div class="eyebrow">Built with</div><div class="big" style="font-size:70px">Every promise is kept by a PayPal action.</div><div class="chips">'+['<b>PayPal</b> Orders: authorize, partial capture, void','<b>PayPal</b> Refunds','<b>PayPal</b> Payouts','<b>PayPal</b> Subscriptions and webhooks','Server SDK by <b>APIMatic</b>','AI on <b>Gemini</b> and <b>Groq</b>','<b>AG Grid</b> and <b>AG Studio</b>','<b>Bryntum</b> Scheduler','<b>Channel3</b> retail prices','<b>Render</b>'].map(x=>'<span class="chip">'+x+'</span>').join('')+'</div></div>';
if(s.kind==='outro')d.innerHTML='<div class="center" style="height:100%;align-items:center;text-align:center;padding:0">'+logo()+'<div class="big" style="font-size:96px;margin-top:40px">Approve the max.<br><span class="brand">Pay what the building unlocked.</span></div><div class="small mono" style="font-size:30px;margin-top:44px">github.com/AnshumSingla/Paypal-AI</div></div>';
root.appendChild(d)});
const ease=(x)=>1-Math.pow(1-Math.min(1,Math.max(0,x)),3);
const CHAR=${CHAR};
const typeInto=(el,full,at,t)=>{const n=Math.max(0,Math.min(full.length,Math.floor((t-at)/CHAR)+1));el.innerHTML='<span>'+full.slice(0,n)+'</span><span style="opacity:0">'+full.slice(n)+'</span>'};
window.renderAt=(t)=>{S.forEach((s,i)=>{const el=document.getElementById('s'+i);const fadeIn=ease((t-s.start)/0.45);const fadeOut=i===S.length-1?1:1-ease((t-(s.end-0.3))/0.45);const o=t<s.start-0.01||t>s.end+0.2?0:Math.min(fadeIn,fadeOut);el.style.opacity=o;
const p=Math.min(1,Math.max(0,(t-s.start)/(s.end-s.start)));
const img=el.querySelector('img');if(img)img.style.transform='scale('+(1+0.035*p)+')';
const cap=el.querySelector('.cap');if(cap){const c=ease((t-s.start-0.35)/0.5);cap.style.opacity=c;cap.style.transform='translateY('+(18*(1-c))+'px)'}
const ty=el.querySelector('.typed');if(ty)typeInto(ty,s.kind==='shot'?s.title:s.big,s.typeAt,t);
el.querySelectorAll('.big:not(.typed),.small,.eyebrow,.chips').forEach((x,j)=>{const c=ease((t-s.start-0.1-j*0.18)/0.6);x.style.opacity=c;x.style.transform='translateY('+(24*(1-c))+'px)'});
})};
window.renderAt(0);
</script></body></html>`;
writeFileSync(join(here, "video.html"), html);
console.log(`scenes ${scenes.length}, ${beat} beats, ${TOTAL}s`);
