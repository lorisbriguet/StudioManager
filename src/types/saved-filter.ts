export interface SavedFilter {
  id: number;
  page: string;
  name: string;
  filters: Record<string, unknown>;
  sort_order: number;
  created_at: string;
}
