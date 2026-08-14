// Catch-all stub for all @tauri-apps/* modules
import { executedStatements } from "./tauri-sql";

export async function invoke(cmd?: string, args?: Record<string, unknown>): Promise<unknown> {
  // Log TransactionBatch statements so tests can assert on batched SQL too
  if (cmd === "execute_batch" && Array.isArray(args?.statements)) {
    for (const stmt of args.statements as { sql: string; params: unknown[] }[]) {
      executedStatements.push({ sql: stmt.sql, params: stmt.params });
    }
    // The real command resolves to { lastInsertId }; return the same shape so
    // callers that read the result (createInvoiceWithLineItems) run under test.
    return { lastInsertId: 1 };
  }
  return null;
}
export async function appDataDir(): Promise<string> {
  return "/tmp/test-app-data";
}
export async function getVersion(): Promise<string> {
  return "0.0.0-test";
}
export async function open(): Promise<null> {
  return null;
}
export async function save(): Promise<null> {
  return null;
}
export async function ask(): Promise<boolean> {
  return false;
}
export async function readFile(): Promise<Uint8Array> {
  return new Uint8Array();
}
export async function writeFile(): Promise<void> {}
export async function copyFile(): Promise<void> {}
export async function mkdir(): Promise<void> {}
export async function exists(): Promise<boolean> {
  return false;
}
export async function check(): Promise<null> {
  return null;
}
export async function relaunch(): Promise<void> {}
export function getCurrentWebview() {
  return {
    listen: () => () => {},
    onDragDropEvent: async () => () => {},
  };
}
export class Command {
  static create() {
    return { execute: async () => ({ stdout: "", stderr: "", code: 0 }) };
  }
}
