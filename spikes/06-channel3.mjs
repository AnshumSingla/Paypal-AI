// Spike ⑥: Channel3 product search for grocery staples: do we get product identity + a retail price?
import "./lib/env.mjs";
import { requireEnv } from "./lib/env.mjs";
import { spike } from "./lib/report.mjs";

const QUERIES = ["large brown eggs 12 count", "basmati rice 10 lb bag", "canola oil 48 oz", "laundry detergent pods 42 count"];

await spike("06", "Channel3 search returns grocery products with prices", async () => {
  const { CHANNEL3_API_KEY } = requireEnv("CHANNEL3_API_KEY");
  const lines = [];
  let firstShape;
  for (const query of QUERIES) {
    const res = await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST",
      headers: { "x-api-key": CHANNEL3_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 3 }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Channel3 ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const items = Array.isArray(body) ? body : body.products ?? body.results ?? body.data ?? [];
    firstShape ??= items[0];
    const top = items[0];
    const price = top?.price?.price ?? top?.price?.amount ?? top?.price ?? top?.offers?.[0]?.price?.price ?? top?.offers?.[0]?.price;
    lines.push(`"${query}" → ${items.length} results; top: ${top?.title ?? "?"} | brand: ${top?.brand_name ?? top?.brand ?? "?"} | price: ${JSON.stringify(price)}`);
  }
  if (firstShape) {
    console.log("First result (full shape, to map into our product table):\n", JSON.stringify(firstShape, null, 2).slice(0, 3000));
  }
  return lines.join("\n");
});
