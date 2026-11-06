import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { keysForTools, touchesCalendar } from "../lib/agentChangeKeys";

/** Every tool name the MCP server logs a write under (`write(dir, org, "<tool>", ...)`). */
function serverWriteTools(): string[] {
  const dir = join(__dirname, "../../src-tauri/mcp/src");
  const tools = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".rs"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\bwrite\(\s*\w+,\s*&?org,\s*"([a-z_]+)"/g)) {
      tools.add(m[1]);
    }
  }
  return [...tools];
}

describe("agent change keys", () => {
  it("knows every tool the MCP server writes with", () => {
    const tools = serverWriteTools();
    expect(tools.length).toBeGreaterThan(15);
    const missing = tools.filter((t) => keysForTools([t]) === null);
    expect(missing).toEqual([]);
  });

  it("merges the keys of several tools", () => {
    expect(keysForTools(["create_client", "link_tool"])).toEqual(["clients", "resources", "resource-tags"]);
  });

  it("falls back to everything for an unknown tool or no list", () => {
    expect(keysForTools(["create_client", "nope"])).toBeNull();
    expect(keysForTools(null)).toBeNull();
  });

  it("syncs the calendar only after upkeep or subscription writes, or when unsure", () => {
    expect(touchesCalendar(["create_task", "put_wiki_article"])).toBe(false);
    expect(touchesCalendar(["create_task", "update_subscription"])).toBe(true);
    expect(touchesCalendar(["nope"])).toBe(true);
    expect(touchesCalendar(null)).toBe(true);
  });
});
