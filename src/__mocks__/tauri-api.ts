// Catch-all stub for all @tauri-apps/* modules
export async function invoke(): Promise<unknown> {
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
  return { listen: () => () => {} };
}
export class Command {
  static create() {
    return { execute: async () => ({ stdout: "", stderr: "", code: 0 }) };
  }
}
