export interface TableColumnDef {
  id: string;
  name: string;
  type: "text" | "number" | "checkbox" | "select" | "tags" | "date";
  options?: string[];
  width?: number;
  linked_list_id?: number;
}

export interface ProjectTable {
  id: number;
  project_id: number;
  name: string;
  column_config: TableColumnDef[];
  sort_order: number;
  created_at: string;
}

export interface ProjectTableRow {
  id: number;
  table_id: number;
  data: Record<string, unknown>;
  sort_order: number;
}
