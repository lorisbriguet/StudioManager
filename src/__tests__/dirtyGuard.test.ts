import { describe, it, expect, vi, beforeEach } from "vitest";
import { ask } from "@tauri-apps/plugin-dialog";
import { registerDirtyGuard, confirmIfDirty, isConfirming } from "../lib/dirty-guard";
import { useAppStore } from "../stores/app-store";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

// The dirty-guard registry is the single gate between a dirty form and any
// programmatic navigation — silent data loss if it misbehaves.

describe("dirty-guard", () => {
  const unregisters: (() => void)[] = [];
  const register = (isDirty: () => boolean, markClean: () => void = () => {}) => {
    const un = registerDirtyGuard(isDirty, markClean);
    unregisters.push(un);
    return un;
  };

  beforeEach(() => {
    useAppStore.setState({ language: "EN" });
    vi.mocked(ask).mockReset();
    while (unregisters.length) unregisters.pop()!();
  });

  it("passes through when no guard is dirty", async () => {
    register(() => false);
    await expect(confirmIfDirty("/somewhere")).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("treats same-path navigation as a no-op even when dirty", async () => {
    register(() => true);
    await expect(confirmIfDirty(window.location.pathname)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("proceeds and marks guards clean when the user confirms leaving", async () => {
    const markClean = vi.fn();
    register(() => true, markClean);
    vi.mocked(ask).mockResolvedValue(true);
    await expect(confirmIfDirty("/away")).resolves.toBe(true);
    expect(markClean).toHaveBeenCalledTimes(1);
  });

  it("blocks navigation and keeps state dirty when the user stays", async () => {
    const markClean = vi.fn();
    register(() => true, markClean);
    vi.mocked(ask).mockResolvedValue(false);
    await expect(confirmIfDirty("/away")).resolves.toBe(false);
    expect(markClean).not.toHaveBeenCalled();
  });

  it("resolves concurrent callers false while a dialog is open", async () => {
    register(() => true);
    let resolveAsk!: (v: boolean) => void;
    vi.mocked(ask).mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveAsk = resolve; })
    );
    const first = confirmIfDirty("/away");
    // Dialog is open — a second caller must not stack another dialog
    await Promise.resolve();
    expect(isConfirming()).toBe(true);
    await expect(confirmIfDirty("/away")).resolves.toBe(false);
    resolveAsk(true);
    await expect(first).resolves.toBe(true);
    expect(isConfirming()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the native dialog errors", async () => {
    register(() => true);
    vi.mocked(ask).mockRejectedValue(new Error("no dialog"));
    await expect(confirmIfDirty("/away")).resolves.toBe(false);
    expect(isConfirming()).toBe(false);
  });

  it("unregistered guards no longer block", async () => {
    const un = register(() => true);
    un();
    await expect(confirmIfDirty("/away")).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});
