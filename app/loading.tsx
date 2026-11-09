export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="card h-28 animate-pulse bg-[#f4f4f3]" />
      <div className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-24 animate-pulse bg-[#f4f4f3]" />
        ))}
      </div>
      <div className="card h-80 animate-pulse bg-[#f4f4f3]" />
    </div>
  );
}
