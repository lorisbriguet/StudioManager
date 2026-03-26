export interface PLData {
  revenue: number;
  invoice_revenue: number;
  other_income: number;
  operating_expenses: CategoryTotal[];
  total_operating: number;
  social_charges: number;
  operating_net: number;
  net_result: number;
}

export interface CategoryTotal {
  category_code: string;
  name_fr: string;
  name_en: string;
  total: number;
}

export interface DashboardKPIs {
  total_invoiced: number;
  open_balance: number;
  overdue_count: number;
  total_expenses: number;
  net_result: number;
  invoice_count: number;
}
