import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Header } from "./_components/Header";

// Plus Jakarta Sans: open shapes and a tall x-height, so prices and small labels stay readable,
// and close in spirit to PayPal's own type.
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans-ui", display: "swap" });

export const metadata: Metadata = {
  // Render sets RENDER_EXTERNAL_URL; social preview images need an absolute base.
  metadataBase: new URL(process.env.RENDER_EXTERNAL_URL || process.env.APP_BASE_URL || "http://localhost:3000"),
  title: { default: "Collective", template: "%s · Collective" },
  description: "Your housing society buys groceries in bulk together. Approve a maximum through PayPal, and pay only the price the building unlocked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <body className="min-h-screen">
        {/* Apply a saved light or dark choice before the page hydrates. */}
        <Script id="theme" strategy="beforeInteractive">{`try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`}</Script>
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-muted">Collective is a PayPal AI Hackathon demo. It runs on the PayPal sandbox, so no real money moves. Prices are in US dollars.</footer>
      </body>
    </html>
  );
}
