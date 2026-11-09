// Building blocks for the signed-in pages, so every page reads the same way:
// a Panel is a titled section, a Stat is a summary card, Empty is what a section says before it has data.
import Link from "next/link";
import { ChevronRight } from "lucide-react";

type Tone = "brand" | "info" | "accent" | "success" | "danger" | "ink";
const TONE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  ink: "bg-surface-2 text-ink",
};

export function IconChip({ icon, tone = "ink" }: { icon: React.ReactNode; tone?: Tone }) {
  return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE[tone]}`}>{icon}</span>;
}

/** A titled section: header row (title, one-line description, optional right side), then the body. */
export function Panel({ id, title, description, aside, children, flush = false, className = "" }: { id?: string; title: string; description?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; flush?: boolean; className?: string }) {
  return (
    <section id={id} className={`card scroll-mt-24 overflow-hidden ${className}`} aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-muted">{description}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      <div className={flush ? "" : "p-6"}>{children}</div>
    </section>
  );
}

/** Summary card: what it is, the number, one sentence, and where to go next. */
export function Stat({ icon, tone = "ink", title, value, sentence, href, action }: { icon: React.ReactNode; tone?: Tone; title: string; value: React.ReactNode; sentence?: React.ReactNode; href?: string; action?: string }) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-center gap-3 px-5 pt-5">
        <IconChip icon={icon} tone={tone} />
        <span className="font-semibold">{title}</span>
      </div>
      <div className="flex-1 px-5 pb-5 pt-4">
        <div className="num text-3xl font-semibold tracking-tight">{value}</div>
        {sentence ? <p className="mt-1 text-sm text-muted">{sentence}</p> : null}
      </div>
      {href && action ? (
        <Link href={href} className="flex items-center gap-1 border-t border-line px-5 py-3 text-sm font-semibold text-brand hover:bg-surface-2">
          {action} <ChevronRight size={16} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <IconChip icon={icon} />
      <p className="mt-3 font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-muted">{children}</p> : null}
    </div>
  );
}
