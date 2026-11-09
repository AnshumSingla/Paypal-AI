"use client"; // Error boundaries must be Client Components
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg py-20">
      <h1 className="text-2xl font-semibold">This page didn&apos;t load</h1>
      <p className="mt-2 text-muted">Something failed on the server. No payment was changed by this error. Try again, or go back to the start.</p>
      <div className="mt-6 flex gap-3">
        <button className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link className="btn btn-ghost" href="/">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
