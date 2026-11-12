"use client";
// A form's submit button that says what's happening while the server action runs.
import { useFormStatus } from "react-dom";

export function PendingButton({ className, pendingLabel, children }: { className: string; pendingLabel: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
