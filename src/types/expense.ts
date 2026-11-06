import type { TagColorName } from "../lib/tagColors";

export interface ExpenseCategory {
  code: string;
  name_fr: string;
  name_en: string;
  pl_section: "operating" | "social_charges";
  color: TagColorName | null;
}

export interface Expense {
  id: number;
  reference: string;
  supplier: string;
  category_code: string;
  invoice_date: string;
  due_date: string | null;
  /** CHF, always: what P&L and exports add up. */
  amount: number;
  /** What the receipt was in; CHF for most. */
  currency: string;
  /** Units of `currency` per 1 CHF; 1 for CHF. */
  exchange_rate: number;
  /** The receipt's own amount in `currency`; null for CHF. */
  original_amount: number | null;
  paid_date: string | null;
  receipt_path: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}
