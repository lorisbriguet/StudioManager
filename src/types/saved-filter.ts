export type FilterOperator = "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte";

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface SavedFilterData {
  search?: string;
  sort?: { key: string; dir: "asc" | "desc" };
  filter?: string;
  tagFilter?: string;
  conditions?: FilterCondition[];
}

export interface SavedFilter {
  id: number;
  page: string;
  name: string;
  filters: SavedFilterData;
  sort_order: number;
  created_at: string;
}

/** Filterable field definition for the UI */
export interface FilterableField {
  key: string;
  label: string;
  type: "string" | "number" | "select";
  options?: { value: string; label: string }[];
}

/**
 * Apply filter conditions to a list of rows.
 * Each row is treated as a Record<string, unknown> for field access.
 */
export function applyFilterConditions<T>(rows: T[], conditions: FilterCondition[]): T[] {
  if (!conditions || conditions.length === 0) return rows;

  return rows.filter((row) => {
    const record = row as Record<string, unknown>;
    return conditions.every((cond) => {
      const rawValue = record[cond.field];
      if (rawValue == null) return false;

      const strValue = String(rawValue).toLowerCase();
      const condValue = cond.value.toLowerCase();

      switch (cond.operator) {
        case "eq":
          return strValue === condValue;
        case "neq":
          return strValue !== condValue;
        case "contains":
          return strValue.includes(condValue);
        case "gt":
          return Number(rawValue) > Number(cond.value);
        case "lt":
          return Number(rawValue) < Number(cond.value);
        case "gte":
          return Number(rawValue) >= Number(cond.value);
        case "lte":
          return Number(rawValue) <= Number(cond.value);
        default:
          return true;
      }
    });
  });
}
