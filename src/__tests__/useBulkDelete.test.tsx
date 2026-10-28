import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { toast } from "sonner";
import { ConfirmHost } from "../components/ui/ConfirmDialog";
import { useBulkDelete } from "../hooks/useBulkDelete";
import { useAppStore } from "../stores/app-store";
import { useUndoStore } from "../stores/undo-store";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

// A fake table: deleting pushes its own undo entry, like the db delete hooks.
let rows: Set<number>;
const remove = async (id: number) => {
  if (id === 99) throw new Error("locked");
  rows.delete(id);
  useUndoStore.getState().push({
    label: `Delete ${id}`,
    execute: () => void rows.add(id),
    redo: () => void rows.delete(id),
  });
};

beforeEach(() => {
  rows = new Set([1, 2, 3, 99]);
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  vi.mocked(toast).mockClear();
});
afterEach(cleanup);

function setup() {
  render(<ConfirmHost />);
  return renderHook(() => useBulkDelete("expenses", remove)).result;
}

describe("useBulkDelete", () => {
  it("asks once with the count, deletes all, and shows ONE toast whose Undo restores all", async () => {
    const hook = setup();
    const onDone = vi.fn();
    let done!: Promise<boolean>;
    act(() => {
      done = hook.current([1, 2, 3], onDone);
    });
    expect(await screen.findByRole("dialog", { name: "Delete 3 expenses?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {
      await expect(done).resolves.toBe(true);
    });

    expect([...rows]).toEqual([99]);
    expect(onDone).toHaveBeenCalledTimes(1);
    // one undo entry for the whole selection
    expect(useUndoStore.getState().stack).toHaveLength(1);
    expect(toast).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(toast).mock.calls[0] as unknown as [string, { action: { onClick: () => Promise<void> }; duration: number }];
    expect(message).toBe("3 expenses deleted");
    expect(options.duration).toBe(8000);

    await act(() => options.action.onClick());
    expect([...rows].sort()).toEqual([1, 2, 3, 99]);
    expect(useUndoStore.getState().stack).toHaveLength(0);
    // and redo deletes them all again
    await act(async () => {
      await useUndoStore.getState().redoStack[0].execute();
    });
    expect([...rows]).toEqual([99]);
  });

  it("does nothing when cancelled", async () => {
    const hook = setup();
    const onDone = vi.fn();
    let done!: Promise<boolean>;
    act(() => {
      done = hook.current([1, 2], onDone);
    });
    expect(await screen.findByRole("dialog", { name: "Delete 2 expenses?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await expect(done).resolves.toBe(false);
    });
    expect(rows.size).toBe(4);
    expect(onDone).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("keeps going past a failed delete and counts only what was deleted", async () => {
    const hook = setup();
    let done!: Promise<boolean>;
    act(() => {
      done = hook.current([1, 99]);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await act(async () => {
      await done;
    });
    expect([...rows]).toEqual([2, 3, 99]);
    expect(vi.mocked(toast).mock.calls[0][0]).toBe("1 expense deleted");
  });
});
