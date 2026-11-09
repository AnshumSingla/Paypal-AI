"use client";
// A sidebar link that knows when it's the current page.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, icon, anchor = false }: { href: string; label: string; icon: React.ReactNode; anchor?: boolean }) {
  const path = usePathname();
  const active = !anchor && path === href;
  return (
    <li className="list-none">
      <Link href={href} className={`nav-item ${active ? "nav-active" : ""}`} aria-current={active ? "page" : undefined}>
        {icon}
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
