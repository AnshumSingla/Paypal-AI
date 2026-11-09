import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Geist: a clean grotesk in the spirit of Stripe's Söhne, for both reading and headlines; Geist Mono for money.
const body = Geist({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  // Render sets RENDER_EXTERNAL_URL; social preview images need an absolute base.
  metadataBase: new URL(process.env.RENDER_EXTERNAL_URL || process.env.APP_BASE_URL || "http://localhost:3000"),
  title: { default: "Collective", template: "%s · Collective" },
  description: "Your housing society buys groceries in bulk together. Approve a maximum through PayPal, and pay only the price the building unlocked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen">
        {/* Apply a saved light or dark choice before the page hydrates. */}
        <Script id="theme" strategy="beforeInteractive">{`try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`}</Script>
        {children}
      </body>
    </html>
  );
}
