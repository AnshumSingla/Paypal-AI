import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-20">
      <h1 className="text-2xl font-semibold">There&apos;s no page here</h1>
      <p className="mt-2 text-muted">The link may be old. Start again and pick who you want to view the week as.</p>
      <Link className="btn btn-primary mt-6" href="/">
        Back to the start
      </Link>
    </div>
  );
}
