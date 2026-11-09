// Social preview card for links to the demo (Devpost, chat apps).
import { ImageResponse } from "next/og";

export const alt = "Collective: your society buys groceries in bulk, together, with PayPal and an AI Society Secretary";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const cells = [1, 0.35, 1, 1, 1, 1, 0.35, 1, 1];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fbfbfa", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#2f3a8f", display: "flex", flexWrap: "wrap", padding: 14, gap: 6 }}>
            {cells.map((o, i) => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: "white", opacity: o }} />
            ))}
          </div>
          <div style={{ fontSize: 40, color: "#1a1c21" }}>Collective</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, color: "#1a1c21", lineHeight: 1.1, maxWidth: 950 }}>Your society buys groceries in bulk, together.</div>
          <div style={{ fontSize: 30, color: "#6b6f78", maxWidth: 950 }}>Approve once with PayPal. An AI Society Secretary gets trusted suppliers to compete. Pay only the price the building unlocked.</div>
        </div>
        <div style={{ display: "flex", gap: 40, fontSize: 28 }}>
          <div style={{ color: "#6b6f78", textDecoration: "line-through" }}>Approved $3.91</div>
          <div style={{ color: "#2f3a8f" }}>Paid $3.43</div>
        </div>
      </div>
    ),
    size,
  );
}
