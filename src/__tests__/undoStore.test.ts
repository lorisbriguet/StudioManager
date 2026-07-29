import { describe, it, expect, beforeEach } from "vitest";
import { useUndoStore } from "../stores/undo-store";

// Mirrors MAX_STACK in src/stores/undo-store.ts
const MAX_STACK = 20;

const mk = (label: string) => ({ label, execute: () => {} });

/** Build a stack of n actions labeled p0 (newest/head) .. p{n-1} (oldest/tail). */
const fill = (n: number, prefix = "a") =>
  Array.from({ length: n }, (_, i) => mk(`${prefix}${i}`));

describe("useUndoStore", () => {
  beforeEach(() => {
    useUndoStore.setState({ stack: [], redoStack: [] });
  });

  it("push adds to the head and clears redo history", () => {
    const store = useUndoStore.getState();
    store.pushRedo(mk("r"));
    store.push(mk("a"));
    store.push(mk("b"));
    const { stack, redoStack } = useUndoStore.getState();
    expect(stack.map((a) => a.label)).toEqual(["b", "a"]);
    expect(redoStack).toEqual([]);
  });

  it("pushRedo does not touch the undo stack", () => {
    const store = useUndoStore.getState();
    store.push(mk("a"));
    const stackBefore = useUndoStore.getState().stack;
    store.pushRedo(mk("r"));
    const { stack, redoStack } = useUndoStore.getState();
    expect(stack).toBe(stackBefore); // same reference — untouched
    expect(redoStack.map((a) => a.label)).toEqual(["r"]);
  });

  it("insertUndo inserts at the given index without clearing redo", () => {
    const store = useUndoStore.getState();
    store.push(mk("c"));
    store.push(mk("b"));
    store.push(mk("a")); // stack: a, b, c
    store.pushRedo(mk("r"));
    store.insertUndo(mk("x"), 1);
    const { stack, redoStack } = useUndoStore.getState();
    expect(stack.map((a) => a.label)).toEqual(["a", "x", "b", "c"]);
    expect(redoStack.map((a) => a.label)).toEqual(["r"]);
  });

  it("insertUndo clamps out-of-range indices", () => {
    const store = useUndoStore.getState();
    store.push(mk("a"));
    store.insertUndo(mk("neg"), -5); // clamped to 0 (head)
    store.insertUndo(mk("big"), 99); // clamped to length (tail)
    const { stack } = useUndoStore.getState();
    expect(stack.map((a) => a.label)).toEqual(["neg", "a", "big"]);
  });

  it("insertUndo caps a full stack at MAX_STACK, dropping the oldest (tail)", () => {
    useUndoStore.setState({ stack: fill(MAX_STACK) }); // a0 (newest) .. a19 (oldest)
    useUndoStore.getState().insertUndo(mk("new"), 0);
    const { stack } = useUndoStore.getState();
    expect(stack).toHaveLength(MAX_STACK);
    expect(stack[0].label).toBe("new");
    expect(stack[MAX_STACK - 1].label).toBe("a18"); // a19 (oldest) dropped
  });

  it("insertUndo at the tail of a full stack drops the inserted action", () => {
    useUndoStore.setState({ stack: fill(MAX_STACK) });
    useUndoStore.getState().insertUndo(mk("new"), MAX_STACK);
    const { stack } = useUndoStore.getState();
    expect(stack).toHaveLength(MAX_STACK);
    expect(stack.some((a) => a.label === "new")).toBe(false);
  });

  it("remove filters the action from both stacks", () => {
    const a = mk("a");
    const r = mk("r");
    useUndoStore.setState({ stack: [mk("x"), a], redoStack: [r, mk("y")] });
    useUndoStore.getState().remove(a);
    useUndoStore.getState().remove(r);
    const { stack, redoStack } = useUndoStore.getState();
    expect(stack.map((x) => x.label)).toEqual(["x"]);
    expect(redoStack.map((x) => x.label)).toEqual(["y"]);
  });

  it("remove is a no-op when the action is absent", () => {
    const store = useUndoStore.getState();
    store.push(mk("a"));
    store.pushRedo(mk("r"));
    store.remove(mk("ghost"));
    const { stack, redoStack } = useUndoStore.getState();
    expect(stack.map((a) => a.label)).toEqual(["a"]);
    expect(redoStack.map((a) => a.label)).toEqual(["r"]);
  });
});
