/**
 * Swiss VAT: a business becomes liable once its turnover in a calendar year
 * reaches CHF 100,000 (art. 10 al. 2 let. a LTVA). The dashboard warns a
 * VAT-exempt profile from 80% of it, while there is still time to register.
 */
export const VAT_THRESHOLD_CHF = 100_000;
export const VAT_WARNING_SHARE = 0.8;

/** The share of the threshold reached (0.84 for CHF 84,000), or null when no warning is due. */
export function vatThresholdWarning(turnoverChf: number, vatExempt: boolean): number | null {
  if (!vatExempt || !Number.isFinite(turnoverChf)) return null;
  const share = turnoverChf / VAT_THRESHOLD_CHF;
  return share >= VAT_WARNING_SHARE ? share : null;
}
