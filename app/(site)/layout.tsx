import { Header } from "@/app/_components/Header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-sm text-muted">Collective is a PayPal AI Hackathon demo. It runs on the PayPal sandbox, so no real money moves. Prices are in US dollars.</footer>
    </>
  );
}
