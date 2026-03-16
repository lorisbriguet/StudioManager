export interface BusinessProfile {
  id: number;
  owner_name: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  ide_number: string;
  affiliate_number: string;
  bank_name: string;
  bank_address: string;
  iban: string;
  clearing: string;
  bic_swift: string;
  /** JSON-encoded string[] of activities (e.g. '["Graphisme","Web design"]') */
  default_activity: string;
  vat_exempt: number;
  default_payment_terms_days: number;
}

/** Parse activities from the stored JSON string. Falls back to single-item array for legacy plain strings. */
export function parseActivities(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s: unknown) => typeof s === "string" && s.length > 0);
  } catch {
    // Legacy: plain string value
  }
  return raw.trim() ? [raw.trim()] : [];
}
