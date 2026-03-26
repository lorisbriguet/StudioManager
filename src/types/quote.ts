export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Quote {
  id: number;
  reference: string;
  client_id: string;
  project_id: number | null;
  status: QuoteStatus;
  language: "FR" | "EN";
  activity: string;
  assignment: string;
  quote_date: string;
  valid_until: string | null;
  subtotal: number;
  discount_applied: number;
  discount_rate: number;
  total: number;
  billing_address_id: number | null;
  converted_to_invoice_id: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface QuoteLineItem {
  id: number;
  quote_id: number;
  designation: string;
  rate: number | null;
  unit: string | null;
  quantity: number;
  amount: number;
  sort_order: number;
}
