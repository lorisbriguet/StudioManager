// Stub for @tauri-apps/plugin-sql
// Tests can inspect executed SQL via `executedStatements` and control
// select results via `setSelectHandler`.
export interface ExecutedStatement {
  sql: string;
  params: unknown[];
}

export const executedStatements: ExecutedStatement[] = [];

export function clearExecutedStatements(): void {
  executedStatements.length = 0;
}

type SelectHandler = (sql: string, params: unknown[]) => unknown[];

let selectHandler: SelectHandler | null = null;

export function setSelectHandler(handler: SelectHandler | null): void {
  selectHandler = handler;
}

export default class Database {
  static async load(): Promise<Database> {
    return new Database();
  }
  async select(sql?: string, params?: unknown[]): Promise<unknown[]> {
    return selectHandler ? selectHandler(sql ?? "", params ?? []) : [];
  }
  // Fidelity note: the real plugin's execute() resolves to
  // { rowsAffected, lastInsertId }; this stub returns void, so code that
  // reads execute()'s result is not exercised by tests.
  async execute(sql?: string, params?: unknown[]): Promise<void> {
    executedStatements.push({ sql: sql ?? "", params: params ?? [] });
  }
  async close(): Promise<boolean> {
    return true;
  }
}
