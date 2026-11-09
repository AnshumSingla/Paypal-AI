// The signed-in app: a sidebar of the person's pages, this week's tools and the four views, and a
// slim top bar. Laid out like a console, coloured like PayPal.
import Link from "next/link";
import { eq } from "drizzle-orm";
import { BarChart3, CalendarRange, Compass, LayoutDashboard, Receipt, ShieldCheck, ShoppingBasket, Sparkles, Store, Truck, UserRound, Landmark, type LucideIcon } from "lucide-react";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { payMode } from "@/lib/paypal/gateway";
import { switchPersona } from "@/app/actions";
import { Logo } from "./Header";
import { NavLink } from "./NavLink";
import { ThemeToggle } from "./ThemeToggle";

const PAGES: Record<string, { href: string; label: string; icon: LucideIcon }[]> = {
  resident: [{ href: "/resident", label: "My week", icon: ShoppingBasket }],
  captain: [
    { href: "/captain", label: "Captain console", icon: LayoutDashboard },
    { href: "/resident", label: "My basket", icon: ShoppingBasket },
  ],
  seller: [{ href: "/seller", label: "Supplier portal", icon: Store }],
  operator: [
    { href: "/ops", label: "Operations", icon: Receipt },
    { href: "/ops/dashboard", label: "Analytics", icon: BarChart3 },
  ],
};
const ROLE: Record<string, { label: string; icon: LucideIcon }> = {
  resident: { label: "Resident", icon: UserRound },
  captain: { label: "Captain", icon: ShieldCheck },
  seller: { label: "Supplier", icon: Truck },
  operator: { label: "Operator", icon: Landmark },
};

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="px-3 text-xs font-semibold uppercase tracking-[0.08em] text-subtle">{label}</div>
      <ul className="mt-2 space-y-0.5">{children}</ul>
    </div>
  );
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  const { db, user } = await getSession();
  const personas = await db.select({ id: s.appUser.id, name: s.appUser.name, role: s.appUser.role }).from(s.appUser).where(eq(s.appUser.isPersona, true));
  const [society] = await db.select().from(s.society).limit(1);
  const role = user?.role ?? "resident";
  const pages = PAGES[role] ?? [];
  const firstName = (user?.name ?? "").split(" ")[0];
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Logo size={32} />
          <span>
            <span className="block text-lg font-semibold leading-tight">Collective</span>
            <span className="block text-sm text-muted">{society?.name ?? "Housing society"}</span>
          </span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Main">
          <Group label="Your pages">
            {pages.map((p) => (
              <NavLink key={p.href} href={p.href} label={p.label} icon={<p.icon size={18} aria-hidden />} />
            ))}
          </Group>
          {(role === "resident" || role === "captain") && (
            <Group label="This week">
              <NavLink href={`${pages[0]?.href ?? "/resident"}#week-timeline`} label="Week timeline" icon={<CalendarRange size={18} aria-hidden />} anchor />
              <NavLink href={`${pages[0]?.href ?? "/resident"}#secretary`} label="Ask the Secretary" icon={<Sparkles size={18} aria-hidden />} anchor />
            </Group>
          )}
          <Group label="View as">
            {personas.map((p) => {
              const R = ROLE[p.role];
              const active = p.id === user?.id;
              return (
                <li key={p.id}>
                  <form action={switchPersona.bind(null, p.id)}>
                    <button className={`nav-item w-full ${active ? "nav-active" : ""}`} aria-current={active ? "true" : undefined}>
                      <R.icon size={18} aria-hidden />
                      <span className="truncate">
                        {R.label} <span className="text-subtle">{p.role === "operator" ? "Ops team" : p.name.split(" ")[0]}</span>
                      </span>
                    </button>
                  </form>
                </li>
              );
            })}
          </Group>
        </nav>
        <div className="border-t border-line px-3 py-3">
          <NavLink href="/" label="Guided tour" icon={<Compass size={18} aria-hidden />} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/85 px-5 py-3 backdrop-blur lg:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <Logo size={28} />
            <span className="hidden font-semibold sm:inline">Collective</span>
          </Link>
          <nav className="flex gap-1 lg:hidden" aria-label="Pages">
            {pages.map((p) => (
              <Link key={p.href} href={p.href} className="whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium text-muted hover:bg-brand-soft hover:text-ink">
                {p.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted md:inline">{today}</span>
            <span className="chip hidden bg-brand-soft text-brand-dark sm:inline-flex" title="No real money moves">
              {payMode() === "sandbox" ? "PayPal sandbox" : "Demo mode"}
            </span>
            <ThemeToggle />
            {user && (
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">{firstName[0]}</span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-sm font-semibold">{firstName}</span>
                  <span className="block text-xs text-muted">{ROLE[role].label}</span>
                </span>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1240px] px-5 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
