import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChanged, useChangedOrMount } from "./useChanged";

// Setting state during render re-runs that render straight away, so every render's
// answer is recorded rather than only the last one.
function track<P>(hook: (p: P) => boolean, initialProps: P) {
  const seen: boolean[] = [];
  const r = renderHook((p: P) => { seen.push(hook(p)); }, { initialProps });
  const step = (p: P) => { seen.length = 0; r.rerender(p); return seen.some(Boolean); };
  return { first: [...seen], step };
}

describe("useChanged", () => {
  it("is false on mount and true only in a render where a dep changed", () => {
    const { first, step } = track(({ a, b }: { a: number; b: string }) => useChanged(a, b), { a: 1, b: "x" });
    expect(first.some(Boolean)).toBe(false);
    expect(step({ a: 1, b: "x" })).toBe(false);
    expect(step({ a: 2, b: "x" })).toBe(true);
    expect(step({ a: 2, b: "x" })).toBe(false);
  });
});

describe("useChangedOrMount", () => {
  it("is true on mount, then only when a dep changed", () => {
    const { first, step } = track(({ a }: { a: number }) => useChangedOrMount(a), { a: 1 });
    expect(first[0]).toBe(true);
    expect(first.slice(1).some(Boolean)).toBe(false);
    expect(step({ a: 1 })).toBe(false);
    expect(step({ a: 3 })).toBe(true);
  });
});
