// Catch-all stub for all @tauri-apps/* modules
import { executedStatements } from "./tauri-sql";

type InvokeHandler = (cmd: string, args: Record<string, unknown>) => unknown;
let invokeHandler: InvokeHandler | null = null;
export const invokedCommands: { cmd: string; args: Record<string, unknown> }[] = [];
export function setInvokeHandler(handler: InvokeHandler | null): void { invokeHandler = handler; }
export function clearInvokedCommands(): void { invokedCommands.length = 0; }

export async function invoke(cmd?: string, args?: Record<string, unknown>): Promise<unknown> {
  const c = cmd ?? "";
  const a = args ?? {};
  invokedCommands.push({ cmd: c, args: a });
  if (c === "execute_batch" && Array.isArray(a.statements)) {
    for (const stmt of a.statements as { sql: string; params: unknown[] }[]) {
      executedStatements.push({ sql: stmt.sql, params: stmt.params });
    }
    return { lastInsertId: 1 };
  }
  return invokeHandler ? await invokeHandler(c, a) : null;
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
// fs write/remove tracking, used to assert on the paths backup.ts's
// writability probe (validateBackupPath) actually writes and removes.
export const writtenFiles: { path: string; data: Uint8Array }[] = [];
export const removedPaths: string[] = [];
let writeFileError: Error | null = null;
export function setWriteFileError(err: Error | null): void {
  writeFileError = err;
}
export function clearFsWrites(): void {
  writtenFiles.length = 0;
  removedPaths.length = 0;
  writeFileError = null;
}
export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  if (writeFileError) throw writeFileError;
  writtenFiles.push({ path, data });
}
export async function remove(path: string): Promise<void> {
  removedPaths.push(path);
}
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
export const windowTitles: string[] = [];
export function getCurrentWindow() {
  return {
    setTitle: async (t: string) => {
      windowTitles.push(t);
    },
  };
}
export class Command {
  static create() {
    return { execute: async () => ({ stdout: "", stderr: "", code: 0 }) };
  }
}
