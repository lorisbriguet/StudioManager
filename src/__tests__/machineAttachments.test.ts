import { describe, it, expect, vi, beforeEach } from "vitest";

const { invoke, openShell, copyFile, execute } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  openShell: vi.fn(async () => undefined),
  copyFile: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ lastInsertId: 1 })),
}));

// vitest aliases every @tauri-apps module to one mock file, so one factory covers them all.
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  open: openShell,
  copyFile,
  mkdir: vi.fn(),
  exists: vi.fn(async () => true),
  remove: vi.fn(),
}));
vi.mock("../lib/orgPaths", () => ({ orgPaths: async () => ({ root: "/data/orgs/a" }) }));
vi.mock("../db/index", () => ({
  getDb: async () => ({ execute, select: vi.fn(async () => []) }),
  validateFields: vi.fn(),
  TransactionBatch: class {},
}));

import { openMachineAttachment } from "../lib/upkeep/openAttachment";
import { addMachineFile } from "../db/queries/machines";

beforeEach(() => vi.clearAllMocks());

describe("machine attachments", () => {
  it("stores the copy in the org folder, not the picked original", async () => {
    await addMachineFile(5, { label: "Manual", kind: "file", path_or_url: "/Users/me/Desktop/manual.pdf" });
    const dest = (copyFile.mock.calls[0] as unknown as string[])[1];
    expect(dest).toMatch(/^\/data\/orgs\/a\/machines\/5\/\d+_manual\.pdf$/);
    expect((copyFile.mock.calls[0] as unknown as string[])[0]).toBe("/Users/me/Desktop/manual.pdf");
    const params = (execute.mock.calls[0] as unknown as unknown[][])[1];
    expect(params[3]).toBe(dest);
  });

  it("opens files through open_in_finder", async () => {
    await openMachineAttachment({ kind: "file", path_or_url: "/data/x.pdf" });
    expect(invoke).toHaveBeenCalledWith("open_in_finder", { path: "/data/x.pdf" });
    expect(openShell).not.toHaveBeenCalled();
  });

  it("opens links through the shell, adding https:// when there is no scheme", async () => {
    await openMachineAttachment({ kind: "link", path_or_url: "example.com/doc" });
    expect(openShell).toHaveBeenCalledWith("https://example.com/doc");
    await openMachineAttachment({ kind: "link", path_or_url: "http://a.b" });
    expect(openShell).toHaveBeenLastCalledWith("http://a.b");
    expect(invoke).not.toHaveBeenCalled();
  });
});
