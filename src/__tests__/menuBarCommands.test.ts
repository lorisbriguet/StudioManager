import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

/**
 * The menu bar panel may call only the app commands of the `menubar-window` set
 * (src-tauri/permissions/windows.toml); Tauri refuses the rest. This walks the panel's imports
 * and checks every command it can reach is in that set, so a panel feature that needs a new
 * command fails here instead of in the panel.
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

/** For each source file: its imports, as (resolved file, imported names or "*"). */
function imports(file: string): { file: string; names: string[] }[] {
  const out: { file: string; names: string[] }[] = [];
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(IMPORT)) {
    const target = resolveImport(file, m[2] ?? m[3]);
    if (!target) continue;
    const clause = m[1] ?? "*";
    const braced = clause.match(/\{([\s\S]*)\}/);
    const names = braced
      ? braced[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean)
      : ["*"];
    out.push({ file: target, names });
  }
  return out;
}

/** A file cut at each top-level `export`: the exported name and its text up to the next one. */
function exportChunks(text: string): { name: string; body: string }[] {
  return text
    .split(/\n(?=export )/)
    .map((body) => ({ name: body.match(/^export (?:async )?(?:function|const) (\w+)/)?.[1] ?? "", body }))
    .filter((c) => c.name);
}

/** Exported functions of a file that call a command, by function name. */
function wrappers(file: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { name, body } of exportChunks(readFileSync(file, "utf8"))) {
    const cmd = [...body.matchAll(INVOKE)][0]?.[1];
    if (cmd) map.set(name, cmd);
  }
  return map;
}

function panelCommands(): Map<string, string[]> {
  const seeds = readdirSync(join(SRC, "menubar")).map((f) => join(SRC, "menubar", f));
  seeds.push(join(SRC, "hooks/useMenuBarNavigate.ts"));
  const seen = new Set<string>();
  const stack = [...seeds];
  const found = new Map<string, string[]>();
  const add = (cmd: string, where: string) => found.set(cmd, [...(found.get(cmd) ?? []), relative(ROOT, where)]);
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const own = wrappers(file);
    // Direct calls outside an exported wrapper count; a wrapper counts only where it is imported.
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

function menubarSet(): string[] {
  const toml = readFileSync(join(ROOT, "src-tauri/permissions/windows.toml"), "utf8");
  const start = toml.indexOf('identifier = "menubar-window"');
  const block = toml.slice(start, toml.indexOf("]", toml.indexOf("permissions = [", start)));
  return [...block.matchAll(/"allow-([a-z-]+)"/g)].map((m) => m[1].replace(/-/g, "_"));
}

/** Reachable through an import but never run in the panel, and refused there if they were. */
const IMPORTED_NOT_CALLED: Record<string, string> = {
  list_organisations: "org-store load(), run by OrgGate in the main window only",
  set_organisation_prefs: "org-store load() and the app-store setters; the panel only reads appearance",
};

describe("menu bar panel commands", () => {
  it("only calls commands its window is allowed", () => {
    const allowed = new Set([...menubarSet(), ...Object.keys(IMPORTED_NOT_CALLED)]);
    const used = panelCommands();
    const refused = [...used].filter(([cmd]) => !allowed.has(cmd)).map(([cmd, where]) => `${cmd} (${where.join(", ")})`);
    expect(refused).toEqual([]);
    // The walk finds the panel's commands at all.
    expect(used.has("agents_list")).toBe(true);
    expect(used.has("routines_run")).toBe(true);
  });

  it("has no allowed command it doesn't use", () => {
    const used = panelCommands();
    expect(menubarSet().filter((c) => !used.has(c))).toEqual([]);
  });
});
