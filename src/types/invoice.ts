export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface Invoice {
  id: number;
  reference: string;
  client_id: string;
  project_id: number | null;
  status: InvoiceStatus;
  language: "FR" | "EN";
  activity: string;
  assignment: string;
  invoice_date: string;
  due_date: string | null;
  payment_terms_days: number;
  subtotal: number;
  discount_applied: number;
  discount_rate: number;
  discount_label: string;
  total: number;
  paid_date: string | null;
  contact_id: number | null;
  billing_address_id: number | null;
  currency: string;
  exchange_rate: number;
  chf_equivalent: number;
  po_number: string | null;
  pdf_path: string | null;
  from_quote_id: number | null;
  notes: string;
  reminder_count: number;
  last_reminder_date: string | null;
  template_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: number;
  invoice_id: number;
  designation: string;
  rate: number | null;
  unit: string | null;
  quantity: number;
  amount: number;
  sort_order: number;
}
