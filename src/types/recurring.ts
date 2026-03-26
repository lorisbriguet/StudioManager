export type RecurringFrequency = "monthly" | "quarterly" | "biannual" | "annual";

export interface RecurringInvoiceTemplate {
  id: number;
  base_invoice_id: number;
  client_id: string;
  frequency: RecurringFrequency;
  next_due: string; // yyyy-MM-dd
  active: number; // 0 or 1
  created_at: string;
  updated_at: string;
}
