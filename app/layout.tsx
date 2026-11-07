import type { Metadata } from "next";
import "./globals.css";
import { Header } from "./_components/Header";

export const metadata: Metadata = {
  title: { default: "PoolCart", template: "%s · PoolCart" },
  description: "Neighbours pool their weekly groceries, local sellers compete, and PayPal charges only the price the building unlocked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-muted">
          PoolCart · PayPal AI Hackathon demo · PayPal sandbox only, no real money moves.
        </footer>
      </body>
    </html>
  );
}
