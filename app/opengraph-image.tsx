// Social preview card for links to the demo (Devpost, chat apps). Matches the landing page's hero.
import { ImageResponse } from "next/og";

export const alt = "Collective: your society buys groceries in bulk, together, with PayPal and an AI Society Secretary";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const cells = [1, 0.35, 1, 1, 1, 1, 0.35, 1, 1];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(105deg, #001c64 0%, #003087 30%, #0059c9 55%, #0070e0 72%, #4cc3ff 100%)", padding: 72, fontFamily: "sans-serif", color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#3d9bff", display: "flex", flexWrap: "wrap", padding: 14, gap: 6 }}>
            {cells.map((o, i) => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: "#00101f", opacity: o }} />
            ))}
          </div>
          <div style={{ fontSize: 40, fontWeight: 600 }}>Collective</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.0, letterSpacing: -2 }}>Buy together. Pay less.</div>
          <div style={{ fontSize: 32, color: "#dbe9ff", maxWidth: 980, lineHeight: 1.35 }}>Each flat approves one PayPal hold. An AI Secretary gets suppliers to lower the price. PayPal charges only what the whole building unlocked.</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#dbe9ff" }}>For housing societies, built on PayPal</div>
      </div>
    ),
    size,
  );
}
