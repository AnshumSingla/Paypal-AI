// Channel3 product search: canonical product identity + a retail reference price for "savings vs
// retail". Without CHANNEL3_API_KEY, search runs over the local catalog only.
export const channel3Enabled = () => Boolean(process.env.CHANNEL3_API_KEY);

export type C3Product = { id: string; title: string; brand: string | null; priceCents: number | null; imageUrl: string | null; url: string | null };

const pickPrice = (p: any): number | null => {
  const candidates = [p?.price?.price, p?.price?.amount, p?.price?.value, typeof p?.price === "number" ? p.price : undefined, p?.offers?.[0]?.price?.price, p?.offers?.[0]?.price?.amount, p?.offers?.[0]?.price];
  for (const c of candidates) {
    const n = typeof c === "string" ? Number(c) : c;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  return null;
};

export async function channel3Search(query: string, limit = 5): Promise<C3Product[]> {
  if (!channel3Enabled()) return [];
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Channel3 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const items: any[] = Array.isArray(body) ? body : (body.products ?? body.results ?? body.data ?? []);
  return items.map((p) => ({
    id: String(p.id ?? p.product_id ?? p.url ?? p.title),
    title: String(p.title ?? p.name ?? "Unknown product"),
    brand: p.brand_name ?? p.brand?.name ?? (typeof p.brand === "string" ? p.brand : null),
    priceCents: pickPrice(p),
    imageUrl: p.image_url ?? p.images?.[0]?.url ?? p.images?.[0] ?? p.image ?? null,
    url: p.url ?? p.offers?.[0]?.url ?? null,
  }));
}
