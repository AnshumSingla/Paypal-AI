"use client";
import { useState, useTransition } from "react";
import { askSecretaryAction } from "@/app/actions";
import { Spinner } from "./ActionButton";

/** Ask the Society Secretary a question; it answers from live data through its tools. */
export function SecretaryAsk({ cycleId, placeholder }: { cycleId: string; placeholder: string }) {
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState<{ ok: boolean; text: string; rules?: boolean } | null>(null);
  const ask = () =>
    start(async () => {
      const r = await askSecretaryAction(cycleId, q);
      setAnswer(r.ok ? { ok: true, text: r.data!.reply, rules: r.data!.source === "rules" } : { ok: false, text: r.error });
    });
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask();
        }}
      >
        <label htmlFor="secretary-q" className="sr-only">
          Ask the Secretary
        </label>
        <input id="secretary-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} maxLength={1000} />
        <button className="btn btn-primary shrink-0" disabled={pending || !q.trim()}>
          {pending ? <Spinner /> : null}
          Ask
        </button>
      </form>
      {answer && (
        <p className={`mt-3 text-sm leading-relaxed ${answer.ok ? "text-ink" : "text-danger"}`} aria-live="polite">
          {answer.text}
          {answer.rules ? <span className="mt-1 block text-xs text-muted">Answered from data only; AI answers are off right now.</span> : null}
        </p>
      )}
    </div>
  );
}
