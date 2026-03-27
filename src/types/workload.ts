export type WorkloadColumnType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "multi_select"
  | "formula"
  | "link";

export interface SelectOption {
  value: string;
  color: string; // gray | brown | orange | yellow | green | blue | purple | pink | red
}

export interface WorkloadColumn {
  key: string;
  name: string;
  type: WorkloadColumnType;
  width?: number;
  icon?: string;
  iconOnly?: boolean;
  options?: SelectOption[];
  formula?: string;
  showSum?: boolean;
  calendarColor?: boolean;
}

export interface WorkloadTemplate {
  id: number;
  name: string;
  is_system: boolean;
  columns: WorkloadColumn[]; // stored as JSON string in DB
  created_at: string;
  updated_at: string;
}

/** Raw row from the database (JSON fields as strings) */
export interface WorkloadTemplateRow {
  id: number;
  name: string;
  is_system: number; // 0 or 1 in SQLite
  columns: string;
  created_at: string;
  updated_at: string;
}

/** A workload row is a task. System columns map to task fields, custom columns to workload_cells JSON. */
export interface WorkloadRow {
  id: number;              // task.id
  project_id: number;      // task.project_id
  title: string;           // task.title (system column: Task)
  status: string;          // task.status
  tracked_minutes: number; // task.tracked_minutes (system column: Duration)
  planned_minutes: number | null; // task.planned_minutes (system column: Planned)
  cells: Record<string, unknown>; // task.workload_cells (parsed JSON)
  sort_order: number;      // task.workload_sort_order
  created_at: string;
  updated_at: string;
}

/** Column definitions stored on project-level (copied from template, then customisable) */
export interface ProjectWorkloadConfig {
  template_id: number | null;
  columns: WorkloadColumn[];
}

export const TAG_COLORS: Record<
  string,
  { bg: string; text: string }
> = {
  gray:   { bg: "bg-gray-200",   text: "text-gray-700" },
  brown:  { bg: "bg-amber-100",  text: "text-amber-800" },
  orange: { bg: "bg-orange-100", text: "text-orange-700" },
  yellow: { bg: "bg-yellow-100", text: "text-yellow-700" },
  green:  { bg: "bg-green-100",  text: "text-green-700" },
  blue:   { bg: "bg-blue-100",   text: "text-blue-700" },
  purple: { bg: "bg-purple-100", text: "text-purple-700" },
  pink:   { bg: "bg-pink-100",   text: "text-pink-700" },
  red:    { bg: "bg-red-100",    text: "text-red-700" },
};

export const TAG_COLOR_NAMES = Object.keys(TAG_COLORS);

export const DEFAULT_WORKLOAD_COLUMNS: WorkloadColumn[] = [
  { key: "asset", name: "Asset", type: "link", width: 160 },
  {
    key: "type",
    name: "Type",
    type: "multi_select",
    width: 140,
    options: [
      { value: "Digital", color: "yellow" },
      { value: "Motion", color: "purple" },
      { value: "Print", color: "orange" },
      { value: "Admin", color: "pink" },
    ],
  },
  { key: "og_scope", name: "OG Scope", type: "checkbox", width: 80 },
  { key: "hours", name: "N of Hours", type: "number", width: 90 },
  {
    key: "template_type",
    name: "Template Type",
    type: "multi_select",
    width: 160,
    options: [
      { value: "Digital", color: "gray" },
      { value: "Video A", color: "blue" },
      { value: "Video B", color: "purple" },
      { value: "No Template Used", color: "red" },
    ],
  },
  { key: "qty", name: "Qty", type: "number", width: 60 },
  { key: "corr_round", name: "Corr. Round", type: "number", width: 90 },
  { key: "notes", name: "Notes", type: "text", width: 200 },
  {
    key: "oos_hours",
    name: "OoS Hours",
    type: "formula",
    width: 90,
    formula: "og_scope ? 0 : hours",
  },
  {
    key: "ios_hours",
    name: "IoS Hours",
    type: "formula",
    width: 90,
    formula: "og_scope ? hours : 0",
  },
];
