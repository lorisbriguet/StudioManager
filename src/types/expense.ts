export type TagColorName = "blue" | "purple" | "green" | "red" | "yellow" | "cyan" | "orange" | "teal" | "gray";

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
  amount: number;
  paid_date: string | null;
  receipt_path: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}
