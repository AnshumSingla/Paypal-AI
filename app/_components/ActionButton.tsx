"use client";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions";

/** Calls a (pre-bound) server action and shows its message or error inline. */
export function ActionButton({
  action,
  children,
  className = "btn btn-primary",
  confirm,
  onDone,
}: {
  action: () => Promise<ActionResult<unknown> | void>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  onDone?: (r: ActionResult<unknown>) => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = (await action()) ?? { ok: true };
            setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
            onDone?.(r);
          });
        }}
      >
        {pending ? <Spinner /> : null}
        {children}
      </button>
      {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
    </span>
  );
}

export function Toast({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`text-xs max-w-md ${ok ? "text-brand-dark" : "text-danger"}`}>{text}</span>;
}

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}
