import { afterEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-log", () => plugin);

import { logError, logInfo, logWarn } from "../lib/log";

afterEach(() => {
  vi.restoreAllMocks();
  plugin.error.mockReset();
  plugin.warn.mockReset();
  plugin.info.mockReset();
});

describe("log", () => {
  it("writes to the plugin when it works", async () => {
    plugin.error.mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await logError("Save failed:", "disk full");
    expect(plugin.error).toHaveBeenCalledWith("Save failed: disk full");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falls back to the console when the plugin call fails", async () => {
    // What a build without the log plugin did: the call rejected and the error was lost.
    plugin.error.mockRejectedValue(new Error("plugin log not found"));
    plugin.warn.mockRejectedValue(new Error("plugin log not found"));
    plugin.info.mockRejectedValue(new Error("plugin log not found"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(logError("Update check failed:", "offline")).resolves.toBeUndefined();
    await logWarn("Slow query");
    await logInfo("Started");

    expect(consoleError).toHaveBeenCalledWith("Update check failed: offline");
    expect(consoleWarn).toHaveBeenCalledWith("Slow query");
    expect(consoleLog).toHaveBeenCalledWith("Started");
  });
});
