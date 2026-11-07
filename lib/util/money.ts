/** Integer cents → "$12.34". */
export const fmt = (cents: number | null | undefined) =>
  cents == null ? "—" : `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Basis points of an amount, rounded half-up to whole cents. */
export const bps = (cents: number, basisPoints: number) => Math.round((cents * basisPoints) / 10_000);

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
