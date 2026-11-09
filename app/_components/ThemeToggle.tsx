"use client";
// Light, dark, or follow the system. Stored per browser; the script in layout.tsx applies it
// before the first paint so the page never flashes the wrong theme.
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") setTheme(saved); // eslint-disable-line react-hooks/set-state-in-effect -- localStorage exists only after mount
    } catch {}
  }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
  };
  return (
    <button type="button" className="btn btn-ghost !px-2 !py-1.5" onClick={() => pick(NEXT[theme])} title={`${LABEL[theme]}. Click to change.`} aria-label={`${LABEL[theme]}. Click to change.`}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        {theme === "dark" ? (
          <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z" fill="currentColor" />
        ) : theme === "light" ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
          </g>
        ) : (
          <g fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="5.8" />
            <path d="M8 2.2v11.6A5.8 5.8 0 0 0 8 2.2Z" fill="currentColor" />
          </g>
        )}
      </svg>
    </button>
  );
}
