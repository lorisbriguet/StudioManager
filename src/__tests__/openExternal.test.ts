import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Both resolve to the same stub file in tests (vitest.config.ts aliases).
vi.mock("@tauri-apps/api/core", () => ({
  open: vi.fn(() => Promise.resolve()),
  invoke: vi.fn(() => Promise.resolve()),
}));

import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { openExternal, revealPath } from "../lib/openExternal";

describe("openExternal / revealPath", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("open the link and the path in the app build", async () => {
    vi.stubEnv("VITE_DEMO_BUILD", "");
    await openExternal("https://example.com/");
    await revealPath("/tmp/folder");
    expect(open).toHaveBeenCalledWith("https://example.com/");
    expect(invoke).toHaveBeenCalledWith("open_in_finder", { path: "/tmp/folder" });
  });

  it("open nothing in the demo, silently", async () => {
    vi.stubEnv("VITE_DEMO_BUILD", "1");
    await expect(openExternal("https://login.tailscale.com/admin/machines")).resolves.toBeUndefined();
    await expect(revealPath("/Users/someone/Documents")).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

/** Every .ts/.tsx file under src, tests excluded. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("external openers", () => {
  // The demo gate lives in one place: a file that opens a link or a path on its
  // own would skip it (Rerun 6: the Tailscale card opened the real login page).
  it("go through src/lib/openExternal.ts only", () => {
    const src = resolve(__dirname, "..");
    const files = sources(src);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((f) => !f.endsWith(join("lib", "openExternal.ts")))
      .filter((f) => {
        const code = readFileSync(f, "utf8");
        return /@tauri-apps\/plugin-(shell|opener)/.test(code) || /open_in_finder|window\.open\(/.test(code);
      })
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });
});
