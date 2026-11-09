import type { Metadata } from "next";
import { Mukta } from "next/font/google";
import "./globals.css";
import { Header } from "./_components/Header";

// Mukta (Ek Type, Mumbai): a calm humanist sans with Devanagari, chosen for an Indian housing society.
const mukta = Mukta({ subsets: ["latin", "devanagari"], weight: ["400", "500", "600", "700"], variable: "--font-mukta", display: "swap" });

export const metadata: Metadata = {
  // Render sets RENDER_EXTERNAL_URL; social preview images need an absolute base.
  metadataBase: new URL(process.env.RENDER_EXTERNAL_URL || process.env.APP_BASE_URL || "http://localhost:3000"),
  title: { default: "Collective", template: "%s · Collective" },
  description: "Your housing society buys groceries in bulk together. Approve a maximum through PayPal, and pay only the price the building unlocked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mukta.variable}>
      <body className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-muted">Collective is a PayPal AI Hackathon demo. It runs on the PayPal sandbox, so no real money moves. Prices are in US dollars.</footer>
      </body>
    </html>
  );
}
