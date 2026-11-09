// AG Studio data sources and the default Collective report.
import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat, AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import { studioTheme } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));
const sumOf = (id: string) => ({ id, aggregation: "sum" as const });
const ratio = (id: string, name: string, description: string, num: string, den: string): AgExpressionFieldDefinition => ({ id, name, description, format: "percentageFormat", isMeasure: true, expression: { operator: "divide", inputs: [sumOf(num), sumOf(den)] } });

export function buildStudioData(data: DashboardData): AgDataSourcesDefinition {
  return {
    description:
      "Collective: residents of an Indian housing society (Gulmohar Residency, Pune) pool weekly grocery demand; local suppliers bid tiered bulk prices; each resident's PayPal authorization holds the top tier price and settlement captures only the unlocked price. An AI Society Secretary ranks suppliers by price and a trust score from verified deliveries and upheld complaints. Amounts are USD. 'Released' lines were in pools that missed their minimum and were never charged.",
    sources: [
      {
        id: "lines",
        name: "Basket lines",
        description: "One row per resident basket line after confirmation. held = PayPal hold at ceiling price; paid = captured at the final tier; retail = retail reference for the same items; savings = retail - paid.",
        data: data.lines,
        fields: fields([
          ["id", "Line ID", "textFormat", true],
          ["week", "Week", "textFormat"],
          ["product", "Product", "textFormat"],
          ["category", "Category", "textFormat"],
          ["seller", "Supplier", "textFormat"],
          ["unit", "Flat", "textFormat"],
          ["outcome", "Outcome", "textFormat"],
          ["qty", "Packs", "integerFormat"],
          ["held", "Held (PayPal authorization)", "currencyFormat"],
          ["paid", "Paid (captured)", "currencyFormat"],
          ["retail", "Retail equivalent", "currencyFormat"],
          ["savings", "Saved vs retail", "currencyFormat"],
          ["refunded", "Refunded", "currencyFormat"],
        ]),
      },
      {
        id: "pools",
        name: "Pools",
        description: "One row per pooled product per week. succeeded=1 when the pool reached the winning supplier's minimum order.",
        data: data.pools,
        fields: fields([
          ["id", "Pool ID", "textFormat", true],
          ["week", "Pool Week", "textFormat"],
          ["product", "Pool Product", "textFormat"],
          ["status", "Pool Status", "textFormat"],
          ["demand", "Demand (packs)", "integerFormat"],
          ["keptQty", "Packs sold", "integerFormat"],
          ["finalUnit", "Final unit price", "currencyFormat"],
          ["retailUnit", "Retail unit price", "currencyFormat"],
          ["poolCount", "Pools", "integerFormat"],
          ["succeeded", "Succeeded pools", "integerFormat"],
          ["settled", "Settled pools", "integerFormat"],
        ]),
      },
      {
        id: "payouts",
        name: "Supplier payouts",
        description: "PayPal Payouts to suppliers after the issue window: net = gross - commission - refunds.",
        data: data.payouts,
        fields: fields([
          ["id", "Payout ID", "textFormat", true],
          ["week", "Payout Week", "textFormat"],
          ["seller", "Payout Supplier", "textFormat"],
          ["plan", "Supplier Plan", "textFormat"],
          ["gross", "Gross", "currencyFormat"],
          ["commission", "Commission", "currencyFormat"],
          ["refunds", "Refunds charged", "currencyFormat"],
          ["net", "Net paid out", "currencyFormat"],
          ["status", "Payout Status", "textFormat"],
        ]),
      },
      {
        id: "payments",
        name: "PayPal payments",
        description: "One row per resident PayPal authorization: held, captured at cutoff, released back, and PayPal fee.",
        data: data.payments,
        fields: fields([
          ["id", "Payment ID", "textFormat", true],
          ["week", "Payment Week", "textFormat"],
          ["method", "Method", "textFormat"],
          ["mode", "PayPal Mode", "textFormat"],
          ["status", "Payment Status", "textFormat"],
          ["held", "Authorized", "currencyFormat"],
          ["captured", "Captured", "currencyFormat"],
          ["released", "Released to buyer", "currencyFormat"],
          ["fee", "PayPal fee", "currencyFormat"],
        ]),
      },
      {
        id: "trust",
        name: "Supplier trust",
        description: "One row per supplier: trust score 0-100 computed from verified events (lines delivered, complaints upheld), smoothed for small samples and weighted to recent weeks. Bid ranking weighs trust at 45%.",
        data: data.trust,
        fields: fields([
          ["supplier", "Trust Supplier", "textFormat"],
          ["trust", "Trust score", "integerFormat"],
          ["delivered", "Lines delivered", "integerFormat"],
          ["issues", "Complaints upheld", "integerFormat"],
        ]),
      },
    ],
    expressions: [
      ratio("savingsRate", "Savings rate", "Saved vs retail / retail equivalent.", "lines.savings", "lines.retail"),
      ratio("captureRate", "Capture ratio", "Captured / authorized: how much of the hold residents actually paid.", "payments.captured", "payments.held"),
      ratio("poolSuccess", "Pool success rate", "Pools that reached MOQ / settled pools.", "pools.succeeded", "pools.settled"),
      ratio("takeRate", "Take rate", "Commission / gross seller sales.", "payouts.commission", "payouts.gross"),
    ],
  };
}

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const kpi = (text: string, value: { id: string; aggregation?: "sum" }) => ({ type: "value" as const, dataMapping: { value: [value] }, format: { title: { enabled: true, text } } });

const overview: AgPageState = {
  id: "overview",
  widgets: {
    "kpi-saved": kpi("Residents saved vs retail", sumOf("lines.savings")),
    "kpi-paid": kpi("Captured from residents", sumOf("payments.captured")),
    "kpi-released": kpi("Hold released back", sumOf("payments.released")),
    "kpi-success": kpi("Pool success rate", { id: "poolSuccess" }),
    "savings-by-product": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "lines.product" }], valueKey: [sumOf("lines.retail"), sumOf("lines.paid")] },
      format: { ...title("Retail equivalent vs what residents paid, by product"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "savings-rate": {
      type: "radial-gauge",
      dataMapping: { value: [{ id: "savingsRate" }] },
      format: { ...title("Savings rate"), style: { scaleLabel: { min: 0, max: 0.5 } } },
    },
    "pool-status": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "pools.status" }], valueKey: [sumOf("pools.poolCount")] },
      format: title("Pools by outcome"),
    },
    "held-vs-captured": {
      type: "column-chart-stacked",
      dataMapping: { categoryKey: [{ id: "payments.week" }], valueKey: [sumOf("payments.captured"), sumOf("payments.released")] },
      format: { ...title("PayPal holds: captured vs released, by week"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "pool-grid": {
      type: "grid",
      dataMapping: { cols: [{ id: "pools.week" }, { id: "pools.product" }, { id: "pools.status" }, { id: "pools.demand" }, { id: "pools.keptQty" }, { id: "pools.finalUnit" }, { id: "pools.retailUnit" }] },
      format: title("Pools"),
    },
  },
  widgetLayout: {
    "kpi-saved": at(0, 0, 6, 6),
    "kpi-paid": at(6, 0, 6, 6),
    "kpi-released": at(12, 0, 6, 6),
    "kpi-success": at(18, 0, 6, 6),
    "savings-by-product": at(0, 6, 16, 20),
    "savings-rate": at(16, 6, 8, 10),
    "pool-status": at(16, 16, 8, 10),
    "held-vs-captured": at(0, 26, 10, 18),
    "pool-grid": at(10, 26, 14, 18),
  },
};

const sellers: AgPageState = {
  id: "sellers",
  widgets: {
    "kpi-gross": kpi("Supplier gross sales", sumOf("payouts.gross")),
    "kpi-commission": kpi("Platform commission", sumOf("payouts.commission")),
    "kpi-net": kpi("Paid out via PayPal Payouts", sumOf("payouts.net")),
    "kpi-take": kpi("Take rate", { id: "takeRate" }),
    "by-seller": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "payouts.seller" }], valueKey: [sumOf("payouts.net"), sumOf("payouts.commission"), sumOf("payouts.refunds")] },
      format: { ...title("Payout breakdown by supplier"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "trust-by-supplier": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "trust.supplier" }], valueKey: [sumOf("trust.trust")] },
      format: title("Trust score by supplier (verified deliveries and complaints)"),
    },
    "payout-grid": {
      type: "grid",
      dataMapping: { cols: [{ id: "payouts.week" }, { id: "payouts.seller" }, { id: "payouts.plan" }, sumOf("payouts.gross"), sumOf("payouts.commission"), sumOf("payouts.refunds"), sumOf("payouts.net"), { id: "payouts.status" }] },
      format: title("Payouts"),
    },
  },
  widgetLayout: {
    "kpi-gross": at(0, 0, 6, 6),
    "kpi-commission": at(6, 0, 6, 6),
    "kpi-net": at(12, 0, 6, 6),
    "kpi-take": at(18, 0, 6, 6),
    "by-seller": at(0, 6, 14, 18),
    "trust-by-supplier": at(14, 6, 10, 18),
    "payout-grid": at(0, 24, 24, 16),
  },
};

export const defaultReport: AgReportState = { selectedPageId: overview.id, pages: [overview, sellers] };

const token = (n: string) => `var(--pc-${n})`;
export const poolcartStudioTheme = studioTheme.withParams({
  fontFamily: token("font"),
  fontSize: 14,
  textColor: token("ink"),
  foregroundColor: token("ink"),
  subtleTextColor: token("muted"),
  backgroundColor: token("surface"),
  borderColor: token("border"),
  accentColor: token("brand"),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [[`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)], [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)]]).flat()),
});
