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
  default_activity: string;
  vat_exempt: number;
  default_payment_terms_days: number;
}
