import Link from "next/link";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { payMode } from "@/lib/paypal/gateway";
import { aiEnabled, aiModel } from "@/lib/ai/claude";
import { channel3Enabled } from "@/lib/channel3";
import { PersonaMenu } from "./PersonaMenu";

const NAV: Record<string, { href: string; label: string }[]> = {
  resident: [{ href: "/resident", label: "My week" }],
  captain: [
    { href: "/captain", label: "Captain console" },
    { href: "/resident", label: "My basket" },
  ],
  seller: [{ href: "/seller", label: "Seller portal" }],
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
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-extrabold tracking-tight">PoolCart</span>
        </Link>
        <nav className="flex gap-1">
          {(user ? NAV[user.role] : []).map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-brand-soft hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="hidden items-center gap-1.5 lg:flex">
            <span className={`chip ${mode === "sandbox" ? "bg-brand-soft text-brand-dark" : "bg-accent-soft text-[#8a5a12]"}`} title={mode === "sandbox" ? "Real PayPal sandbox API calls" : "No PayPal keys set: an in-process mock with the same rules"}>
              PayPal {mode === "sandbox" ? "sandbox" : "mock"}
            </span>
            <span className={`chip ${aiEnabled() ? "bg-brand-soft text-brand-dark" : "bg-accent-soft text-[#8a5a12]"}`} title={aiEnabled() ? aiModel() : "No Claude key: rule-based fallbacks"}>
              AI {aiEnabled() ? "Claude" : "rules"}
            </span>
            <span className={`chip ${channel3Enabled() ? "bg-brand-soft text-brand-dark" : "bg-accent-soft text-[#8a5a12]"}`}>Channel3 {channel3Enabled() ? "on" : "off"}</span>
          </div>
          <PersonaMenu personas={personas} currentId={user?.id} />
        </div>
      </div>
    </header>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--pc-brand)" />
      <circle cx="11" cy="13" r="4" fill="#fff" />
      <circle cx="21" cy="13" r="4" fill="#fff" opacity=".75" />
      <path d="M7 21h18l-2 5H9z" fill="var(--pc-accent)" />
    </svg>
  );
}
