"use client";
// A1 Basket Assistant UI: type a list or snap a photo → AI-structured lines → resident edits → save.
import { useState, useTransition } from "react";
import { parseListAction, saveNeedsAction } from "@/app/actions";
import type { BasketLineDraft } from "@/lib/ai/agents/basket";
import { Spinner, Toast } from "@/app/_components/ActionButton";
import { fileToDataUrl } from "@/app/_components/image";

const SAMPLE = "2 dozen eggs, any brand\n10lb India Gate basmati\ncanola oil big bottle\n1 gal whole milk x2\ndish soap\na 12 pack of beer";

export function BasketAssistant({ cycleId }: { cycleId: string }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [lines, setLines] = useState<BasketLineDraft[] | null>(null);
  const [meta, setMeta] = useState<{ source: string; model: string; error?: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const parse = () =>
    start(async () => {
      setMsg(null);
      const r = await parseListAction({ text: text || undefined, imageDataUrl: photo ?? undefined });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setLines(r.data!.lines);
      setMeta({ source: r.data!.source, model: r.data!.model, error: r.data!.error });
    });

  const save = () =>
    start(async () => {
      const r = await saveNeedsAction(cycleId, lines!, photo ? "photo" : "text");
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
      if (r.ok) {
        setLines(null);
        setText("");
        setPhoto(null);
      }
    });

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">What do you need this week?</h2>
        <span className="chip bg-info-soft text-info">Basket Assistant · AI</span>
      </div>
      {!lines ? (
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
          <div>
            <textarea className="input min-h-36 font-mono text-sm" placeholder={SAMPLE} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="mt-1 text-xs font-semibold text-brand underline" onClick={() => setText(SAMPLE)}>
              Use a sample list
            </button>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-3 text-center text-sm text-muted hover:bg-brand-soft">
            {photo ? <img src={photo} alt="Your list" className="max-h-36 rounded-lg object-contain" /> : <span className="text-3xl">📷</span>}
            <span className="font-semibold">{photo ? "Change photo" : "Snap or upload a photo of your list"}</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && setPhoto(await fileToDataUrl(e.target.files[0]))} />
          </label>
          <div className="md:col-span-2">
            <button className="btn btn-primary" disabled={pending || (!text.trim() && !photo)} onClick={parse}>
              {pending && <Spinner />} Read my list
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-muted">
            {meta?.source === "ai" ? `Read by ${meta.model}.` : "Read with the rule-based fallback (no AI key)."} Check each line, then add them to this week&apos;s needs.
            {meta?.error ? <span className="text-danger"> AI error: {meta.error}</span> : null}
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {lines.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={l.quantity}
                  disabled={l.restricted || !l.productId}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))}
                  className="input !w-16 !py-1"
                />
                <div className="min-w-48 flex-1">
                  <div className="font-semibold">
                    {l.productTitle ?? l.productQuery} {l.packSize ? <span className="text-muted">· {l.packSize}</span> : null}
                  </div>
                  <div className="text-xs text-muted">
                    “{l.raw}”{l.brand ? ` · brand: ${l.brand}` : " · any brand"}
                    {l.matchedVia === "channel3" ? " · matched via Channel3" : ""}
                  </div>
                  {l.clarification && !l.restricted ? <div className="text-xs text-[#8a5a12]">? {l.clarification}</div> : null}
                </div>
                {l.restricted ? (
                  <span className="chip bg-danger-soft text-danger">Not allowed on PoolCart</span>
                ) : l.productId ? (
                  <span className="chip bg-brand-soft text-brand-dark">retail {l.retailRefCents ? `$${(l.retailRefCents / 100).toFixed(2)}` : "?"}</span>
                ) : (
                  <span className="chip bg-accent-soft text-[#8a5a12]">No match</span>
                )}
                <button className="text-xs text-muted hover:text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={pending || !lines.some((l) => l.productId && !l.restricted)} onClick={save}>
              {pending && <Spinner />} Add to this week&apos;s needs
            </button>
            <button className="btn btn-ghost" onClick={() => setLines(null)}>
              Start over
            </button>
          </div>
        </div>
      )}
      {msg ? (
        <div className="mt-3">
          <Toast ok={msg.ok} text={msg.text} />
        </div>
      ) : null}
    </div>
  );
}
