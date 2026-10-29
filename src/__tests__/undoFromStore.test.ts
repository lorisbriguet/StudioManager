import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUndoStore } from "../stores/undo-store";
import { deleteWithUndo, undoableFromStore, undoTop } from "../lib/undo";
import { notify } from "../lib/notify";

vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<object>()),
  notify: { success: vi.fn(), undo: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const older = { label: "older", execute: vi.fn() };

beforeEach(() => {
  useUndoStore.setState({ stack: [older], redoStack: [] });
  vi.mocked(notify.success).mockClear();
  vi.mocked(notify.undo).mockClear();
});

describe("undo toast from the undo store", () => {
  it("a mutation that pushes an entry gets an Undo bound to it", () => {
    const pushed = { label: "new", execute: vi.fn() };
    const mutation = {
      mutate: (_id: number, opts: { onSuccess: () => void }) => {
        useUndoStore.getState().push(pushed);
        opts.onSuccess();
      },
    };
    deleteWithUndo(mutation, 1, "Deleted");
    expect(notify.undo).toHaveBeenCalledWith("Deleted", expect.any(Function));
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("a mutation that pushes nothing shows a plain success, not an Undo for an older entry", async () => {
    const onSuccess = vi.fn();
    const mutation = { mutate: (_id: number, opts: { onSuccess: () => void }) => opts.onSuccess() };
    deleteWithUndo(mutation, 1, "Deleted", onSuccess);
    expect(notify.undo).not.toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith("Deleted");
    expect(onSuccess).toHaveBeenCalled();
    expect(older.execute).not.toHaveBeenCalled();
  });

  it("undoableFromStore compares against the top read before the mutation", () => {
    const before = undoTop();
    undoableFromStore("Saved", before);
    expect(notify.success).toHaveBeenCalledWith("Saved");
    useUndoStore.getState().push({ label: "x", execute: () => {} });
    undoableFromStore("Saved", before);
    expect(notify.undo).toHaveBeenCalledTimes(1);
  });

  it("an empty stack before and after gives a plain success", () => {
    useUndoStore.setState({ stack: [] });
    undoableFromStore("Saved", undoTop());
    expect(notify.success).toHaveBeenCalledWith("Saved");
  });
});
