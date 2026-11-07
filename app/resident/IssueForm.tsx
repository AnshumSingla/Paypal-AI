"use client";
// A6: report a delivery issue with a photo. The Issue Resolver proposes a refund; small ones are
// auto-approved under policy and refunded through PayPal immediately.
import { useState, useTransition } from "react";
import { reportIssueAction } from "@/app/actions";
import { Spinner, Toast } from "@/app/_components/ActionButton";
import { fileToDataUrl } from "@/app/_components/image";

export function IssueForm({ basketLineId, maxQty, title }: { basketLineId: string; maxQty: number; title: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"missing" | "damaged" | "wrong_item" | "quality">("damaged");
  const [qty, setQty] = useState(1);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button className="text-xs font-semibold text-danger underline" onClick={() => setOpen(true)}>
          Report a problem
        </button>
        {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
      </span>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-xl border border-line bg-canvas p-3 text-sm">
      <div className="font-semibold">Problem with {title}</div>
      <div className="flex flex-wrap gap-2">
        <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="damaged">Damaged</option>
          <option value="missing">Missing</option>
          <option value="wrong_item">Wrong item</option>
          <option value="quality">Quality</option>
        </select>
        <label className="flex items-center gap-1">
          Packs
          <input type="number" min={1} max={maxQty} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="input !w-16" />
        </label>
      </div>
      <textarea className="input" placeholder="What happened?" value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="block text-xs">
        Photo {type === "missing" ? "(optional)" : "(required)"}:{" "}
        <input type="file" accept="image/*" capture="environment" onChange={async (e) => e.target.files?.[0] && setPhoto(await fileToDataUrl(e.target.files[0], 1200))} />
      </label>
      {photo ? <img src={photo} alt="Issue photo" className="max-h-28 rounded-lg" /> : null}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={pending || !description.trim()}
          onClick={() =>
            start(async () => {
              const r = await reportIssueAction({ basketLineId, type, qty, description, photoDataUrl: photo });
              setMsg(r.ok ? { ok: true, text: r.message ?? "Reported." } : { ok: false, text: r.error });
              if (r.ok) setOpen(false);
            })
          }
        >
          {pending && <Spinner />} Submit
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
    </div>
  );
}
