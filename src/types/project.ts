export type ProjectStatus = "active" | "completed" | "on_hold" | "cancelled";

export type BlockType = "tasks" | "workload" | "resources" | "notes" | "named_tables" | "invoices" | "quotes";

export interface LayoutBlock {
  type: BlockType;
  collapsed?: boolean;
}

export type LayoutConfig = LayoutBlock[];

export const STANDARD_LAYOUT: LayoutConfig = [
  { type: "tasks" },
  { type: "notes" },
  { type: "workload" },
  { type: "resources" },
  { type: "named_tables" },
];

export const PROJECT_TEMPLATES: Record<string, { label: string; layout: LayoutConfig }> = {
  standard: { label: "Standard", layout: STANDARD_LAYOUT },
  creative: { label: "Creative Brief", layout: [{ type: "tasks" }, { type: "notes" }, { type: "resources" }, { type: "quotes" }] },
  production: { label: "Production", layout: [{ type: "tasks" }, { type: "workload" }, { type: "named_tables" }] },
  simple: { label: "Simple", layout: [{ type: "tasks" }, { type: "notes" }] },
};

export interface Project {
  id: number;
  client_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string | null;
  deadline: string | null;
  notes: string;
  layout_config: string | null;
  created_at: string;
  updated_at: string;
}
