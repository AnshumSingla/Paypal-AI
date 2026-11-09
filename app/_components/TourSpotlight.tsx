"use client";
// The guided tour as a spotlight: the page dims except the part this step is about, and a card in the
// corner says what's happening, what could go wrong, and runs the step. Each step does the real thing
// (adds the list, places the hold, cuts off), then opens the view where the next one happens.
// Skip hides it for this visit; a small chip brings it back.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tourJumpAction, tourNextAction } from "@/app/actions";
import { Spinner } from "./ActionButton";

type Box = { x: number; y: number; w: number; h: number };
export type SpotStep = { choices: { id: string; label: string; hint: string }[]; n: number; total: number; title: string; body: string; edge: string[]; action: string | null; target: string | null; here: boolean; jumpTo: "resident" | "captain" | "seller" | "operator"; jumpLabel: string };

const PAD = 10;
const HIDDEN = "tour:hidden";
const pad2 = (n: number) => String(n).padStart(2, "0");
const hole = ({ x, y, w, h }: Box) => {
  const r = Math.min(12, w / 2, h / 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  return `M0 0H${W}V${H}H0Z M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
};

export function TourSpotlight({ cycleId, step }: { cycleId: string; step: SpotStep }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edgeOpen, setEdgeOpen] = useState(false);
  // The card sits opposite the spotlit section so it never covers it.
  const [side, setSide] = useState<"right" | "left">("right");
  const pathRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<SVGRectElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cur = useRef<Box>({ x: 0, y: 0, w: 0, h: 0 });

  // Remember a skip for this visit; carry a step's result across the page change.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(HIDDEN) === "1") setOpen(false); // eslint-disable-line react-hooks/set-state-in-effect -- browser storage exists only after mount
      const carried = sessionStorage.getItem("tour-msg");
      if (carried) {
        sessionStorage.removeItem("tour-msg");
        setMsg({ ok: true, text: carried });
      }
    } catch {}
  }, []);

  const draw = useCallback(() => {
    const b = cur.current;
    pathRef.current?.setAttribute("d", b.w ? hole(b) : `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`);
    const ring = ringRef.current;
    if (ring) {
      ring.setAttribute("x", String(b.x));
      ring.setAttribute("y", String(b.y));
      ring.setAttribute("width", String(b.w));
      ring.setAttribute("height", String(b.h));
      ring.setAttribute("opacity", b.w ? "1" : "0");
    }
  }, []);

  // Follow the target: ease the hole towards it every frame while open.
  useEffect(() => {
    if (!open) return;
    const el = step.here && step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"], #${step.target}`) : null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Tall sections scroll to their top so the reader starts at their heading; short ones are centred.
    if (el) {
      const r0 = el.getBoundingClientRect();
      setSide(r0.left + r0.width / 2 > window.innerWidth * 0.55 ? "left" : "right"); // eslint-disable-line react-hooks/set-state-in-effect -- measured from the DOM after render
    } else setSide("right");
    if (el) el.scrollIntoView({ block: el.offsetHeight > window.innerHeight * 0.6 ? "start" : "center", behavior: reduced ? "auto" : "smooth" });
    let raf = 0;
    const tick = () => {
      let goal: Box = { x: window.innerWidth / 2, y: window.innerHeight / 2, w: 0, h: 0 };
      if (el) {
        const r = el.getBoundingClientRect();
        const top = Math.max(r.top - PAD, 72);
        goal = { x: Math.max(r.left - PAD, PAD), y: top, w: Math.min(r.width + PAD * 2, window.innerWidth - PAD * 2), h: Math.max(Math.min(r.bottom + PAD, window.innerHeight - PAD) - top, 0) };
      }
      const c = cur.current;
      const k = reduced ? 1 : 0.18;
      cur.current = { x: c.x + (goal.x - c.x) * k, y: c.y + (goal.y - c.y) * k, w: c.w + (goal.w - c.w) * k, h: c.h + (goal.h - c.h) * k };
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t = setTimeout(() => nextRef.current?.focus(), 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [open, step.here, step.target, step.n, draw]);

  const hide = useCallback(() => {
    setOpen(false);
    try {
      sessionStorage.setItem(HIDDEN, "1");
    } catch {}
  }, []);
  const show = () => {
    setOpen(true);
    try {
      sessionStorage.removeItem(HIDDEN);
    } catch {}
  };

  const go = useCallback(
    (fn: () => ReturnType<typeof tourNextAction>) =>
      start(async () => {
        const r = await fn();
        setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
        setEdgeOpen(false);
        if (r.ok && r.data?.href) {
          try {
            if (r.message) sessionStorage.setItem("tour-msg", r.message);
          } catch {}
          router.push(r.data.href);
        }
        router.refresh();
      }),
    [router],
  );
  const choose = step.here && step.choices.length > 0;
  const primary = useCallback(() => {
    if (!step.here) go(() => tourJumpAction(step.jumpTo));
    else if (step.action) go(() => tourNextAction(cycleId, step.choices[0]?.id));
    else hide();
  }, [step.here, step.action, step.jumpTo, step.choices, cycleId, go, hide]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (e.key === "Escape") hide();
      else if (e.key === "ArrowRight" && !pending) primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, hide, primary]);

  const label = !step.here ? step.jumpLabel : (step.action ?? "Finish the tour");

  if (!open)
    return (
      <div role="status" className="card fixed bottom-4 left-4 z-50 flex items-center gap-3 py-2 pl-4 pr-2 lg:left-[276px]">
        <span className="text-sm text-muted">
          <span className="font-semibold text-ink">Guided tour</span> step {step.n} of {step.total}
        </span>
        <button type="button" className="btn btn-ghost !min-h-0 !px-3 !py-1.5 text-sm" onClick={show}>
          Resume
        </button>
      </div>
    );

  return (
    <div role="dialog" aria-modal="false" aria-label={`Guided tour, step ${step.n} of ${step.total}`} className="pointer-events-none fixed inset-0 z-[60]">
      <svg aria-hidden className="absolute inset-0 h-full w-full">
        <path ref={pathRef} fillRule="evenodd" className="pointer-events-auto" style={{ fill: "var(--pc-canvas)", fillOpacity: 0.72 }} onClick={hide} />
        <rect ref={ringRef} rx={12} fill="none" strokeWidth={2} style={{ stroke: "var(--pc-brand)" }} />
      </svg>

      <div className={`card pointer-events-auto absolute inset-x-0 bottom-0 overflow-hidden !rounded-b-none sm:inset-x-auto sm:bottom-6 sm:w-[400px] sm:!rounded-b-[12px] ${side === "right" ? "sm:right-6" : "sm:left-6 lg:left-[284px]"}`} style={{ boxShadow: "0 30px 60px -20px rgba(10,37,64,.35)" }}>
        <div className="max-h-[calc(100vh-7rem)] overflow-y-auto px-6 pb-5 pt-4">
          <div className="flex items-center justify-between">
            <span className="mono text-sm text-subtle">
              {pad2(step.n)} / {pad2(step.total)}
            </span>
            <button type="button" onClick={hide} className="text-sm font-medium text-muted hover:text-ink">
              Skip
            </button>
          </div>
          <h2 className="mt-2 text-xl font-semibold">{step.title}</h2>
          <p className="mt-1.5 text-muted">{step.body}</p>
          {msg && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.text}</p>}
          {step.edge.length > 0 && (
            <div className="mt-3">
              <button type="button" className="text-sm font-semibold text-brand" aria-expanded={edgeOpen} onClick={() => setEdgeOpen((v) => !v)}>
                {edgeOpen ? "Hide" : "What could go wrong here?"}
              </button>
              {edgeOpen && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {step.edge.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {choose && (
            <fieldset className="mt-4" disabled={pending}>
              <legend className="text-sm font-semibold">Choose what happens</legend>
              <ul className="mt-2 space-y-2">
                {step.choices.map((c, i) => (
                  <li key={c.id}>
                    <button type="button" ref={i === 0 ? nextRef : undefined} onClick={() => go(() => tourNextAction(cycleId, c.id))} className="w-full rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand-soft disabled:opacity-60">
                      <span className="block font-semibold">{c.label}</span>
                      <span className="block text-sm text-muted">{c.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <div className="mt-5 flex items-center gap-2">
            {!choose && (
              <button ref={nextRef} type="button" className="btn btn-primary" disabled={pending} onClick={primary}>
                {pending && <Spinner />}
                {label}
              </button>
            )}
            {choose && pending && (
              <span className="flex items-center gap-2 text-sm text-muted">
                <Spinner /> Running it for real…
              </span>
            )}
            <span className="ml-auto hidden items-center gap-1.5 md:flex">
              <kbd className="kbd">→</kbd>
              <kbd className="kbd">esc</kbd>
            </span>
          </div>
        </div>
        <div className="h-0.5 bg-track">
          <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${(step.n / step.total) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
