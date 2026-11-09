"use client";
import { useTransition } from "react";
import { switchPersona } from "@/app/actions";

const ROLE: Record<string, string> = { resident: "resident", captain: "captain", seller: "supplier", operator: "operator" };

export function PersonaMenu({ personas, currentId }: { personas: { id: string; name: string; role: string }[]; currentId?: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="label hidden sm:inline">Viewing as</span>
      <select
        className="input !w-auto !py-1.5 font-medium"
        value={currentId ?? ""}
        disabled={pending}
        onChange={(e) => start(() => switchPersona(e.target.value))}
      >
        {!currentId && <option value="">Choose who to view as</option>}
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}, {ROLE[p.role] ?? p.role}
          </option>
        ))}
      </select>
    </label>
  );
}
