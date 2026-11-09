import Link from "next/link";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { payMode } from "@/lib/paypal/gateway";
import { aiEnabled, aiModel } from "@/lib/ai/llm";
import { channel3Enabled } from "@/lib/channel3";
import { PersonaMenu } from "./PersonaMenu";
import { ThemeToggle } from "./ThemeToggle";

const NAV: Record<string, { href: string; label: string }[]> = {
  resident: [{ href: "/resident", label: "My week" }],
  captain: [
    { href: "/captain", label: "Captain console" },
    { href: "/resident", label: "My basket" },
  ],
  seller: [{ href: "/seller", label: "Supplier portal" }],
  operator: [
    { href: "/ops", label: "Operations" },
    { href: "/ops/dashboard", label: "AG Studio dashboard" },
  ],
};

export async function Header() {
  const { db, user } = await getSession();
  const personas = await db.select({ id: s.appUser.id, name: s.appUser.name, role: s.appUser.role }).from(s.appUser).where(eq(s.appUser.isPersona, true));
  const mode = payMode();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Collective</span>
        </Link>
        <nav className="flex gap-1">
          {(user ? NAV[user.role] : []).map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-brand-soft hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* Residents, captains and suppliers see one plain chip; the operator sees what's connected. */}
          {user?.role === "operator" ? (
            <div className="hidden items-center gap-1.5 lg:flex">
            <span className={`chip ${mode === "sandbox" ? "bg-brand-soft text-brand-dark" : "bg-accent-soft text-accent-ink"}`} title={mode === "sandbox" ? "Real PayPal sandbox API calls" : "No PayPal keys set: an in-process mock with the same rules"}>
              PayPal {mode === "sandbox" ? "sandbox" : "mock"}
            </span>
            <span className={`chip ${aiEnabled() ? "bg-brand-soft text-brand-dark" : "bg-accent-soft text-accent-ink"}`} title={aiEnabled() ? aiModel() : "No Gemini or Groq key: rule-based fallbacks"}>
              AI {aiEnabled() ? "on" : "rules"}
            </span>
            <span className={`chip ${channel3Enabled() ? "bg-brand-soft text-brand-dark" : "bg-accent-soft text-accent-ink"}`}>Channel3 {channel3Enabled() ? "on" : "off"}</span>
            </div>
          ) : (
            <span className="chip hidden bg-brand-soft text-brand-dark sm:inline-flex" title={`PayPal ${mode === "sandbox" ? "sandbox" : "stand-in"}, AI ${aiEnabled() ? "on" : "rules"}. No real money moves.`}>
              {mode === "sandbox" ? "PayPal sandbox" : "Demo mode"}
            </span>
          )}
          <ThemeToggle />
          <PersonaMenu personas={personas} currentId={user?.id} />
        </div>
      </div>
    </header>
  );
}

/** A building's grid of flats; the lit ones have joined this week's order. */
export function Logo({ size = 26 }: { size?: number }) {
  const lit = new Set([0, 2, 3, 4, 5, 7, 8]);
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" fill="var(--pc-brand)" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={6 + (i % 3) * 5} y={6 + Math.floor(i / 3) * 5} width="3.2" height="3.2" rx="0.8" fill="var(--pc-on-brand)" opacity={lit.has(i) ? 1 : 0.35} />
      ))}
    </svg>
  );
}
