export interface Income {
  id: number;
  reference: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  source: string;
  receipt_path: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}
