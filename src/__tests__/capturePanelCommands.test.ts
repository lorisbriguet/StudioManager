import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

/**
 * The capture panel may call only the app commands of the `capture-window` set
 * (src-tauri/permissions/windows.toml). This walks the imports of src/capture/CaptureApp.tsx
 * (the same walk as menuBarCommands.test.ts) and checks every command it can reach is in that set.
 */
const SRC = resolve(__dirname, "..");
const ROOT = resolve(SRC, "..");

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const IMPORT = /(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const INVOKE = /invoke\s*(?:<[^>(]*>)?\(\s*["'`]([a-z_]+)["'`]/g;

function imports(file: string): { file: string; names: string[] }[] {
  const out: { file: string; names: string[] }[] = [];
  for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
    const target = resolveImport(file, m[2] ?? m[3]);
    if (!target) continue;
    const braced = (m[1] ?? "*").match(/\{([\s\S]*)\}/);
    const names = braced
      ? braced[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean)
      : ["*"];
    out.push({ file: target, names });
  }
  return out;
}

function exportChunks(text: string): { name: string; body: string }[] {
  return text
    .split(/\n(?=export )/)
    .map((body) => ({ name: body.match(/^export (?:async )?(?:function|const) (\w+)/)?.[1] ?? "", body }))
    .filter((c) => c.name);
}

function wrappers(file: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { name, body } of exportChunks(readFileSync(file, "utf8"))) {
    const cmd = [...body.matchAll(INVOKE)][0]?.[1];
    if (cmd) map.set(name, cmd);
  }
  return map;
}

function panelCommands(): Map<string, string[]> {
  const stack = [join(SRC, "capture/CaptureApp.tsx")];
  const seen = new Set<string>();
  const found = new Map<string, string[]>();
  const add = (cmd: string, where: string) => found.set(cmd, [...(found.get(cmd) ?? []), relative(ROOT, where)]);
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const own = wrappers(file);
    let text = readFileSync(file, "utf8");
    for (const { name, body } of exportChunks(text)) {
      if (own.has(name)) text = text.replace(body, "");
    }
    for (const m of text.matchAll(INVOKE)) add(m[1], file);
    for (const imp of imports(file)) {
      stack.push(imp.file);
      const theirs = wrappers(imp.file);
      for (const name of imp.names) {
        if (name === "*") theirs.forEach((cmd) => add(cmd, file));
        else if (theirs.has(name)) add(theirs.get(name)!, file);
      }
    }
  }
  return found;
}

function captureSet(): string[] {
  const toml = readFileSync(join(ROOT, "src-tauri/permissions/windows.toml"), "utf8");
  const start = toml.indexOf('identifier = "capture-window"');
  const block = toml.slice(start, toml.indexOf("]", toml.indexOf("permissions = [", start)));
  return [...block.matchAll(/"allow-([a-z-]+)"/g)].map((m) => m[1].replace(/-/g, "_"));
}

/** Reachable through the app store's imports but never run in the panel (see menuBarCommands.test.ts). */
const IMPORTED_NOT_CALLED = ["list_organisations", "set_organisation_prefs"];

function calledCommands(): string[] {
  return [...panelCommands().keys()].filter((c) => !IMPORTED_NOT_CALLED.includes(c)).sort();
}

describe("capture panel commands", () => {
  it("calls only capture_add, capture_projects and capture_hide", () => {
    expect(calledCommands()).toEqual(["capture_add", "capture_hide", "capture_projects"]);
  });

  it("is allowed exactly the commands it calls", () => {
    expect(captureSet().sort()).toEqual(calledCommands());
  });
});
