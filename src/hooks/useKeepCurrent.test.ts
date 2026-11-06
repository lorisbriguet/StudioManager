import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { useKeepCurrent } from "./useKeepCurrent";

describe("useKeepCurrent", () => {
  it("holds the latest value, already updated when the effects run", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(({ value }) => {
      const ref = useRef(value);
      useKeepCurrent(ref, value);
      useEffect(() => {
        seen.push(ref.current);
      });
      return ref;
    }, { initialProps: { value: "a" } });

    rerender({ value: "b" });
    rerender({ value: "c" });
    expect(seen).toEqual(["a", "b", "c"]);
  });
});
