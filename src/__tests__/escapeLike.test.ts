import { describe, it, expect } from "vitest";
import { escapeLike } from "../db/queries/escapeLike";

describe("escapeLike", () => {
  it("escapes %, _ and the backslash escape character", () => {
    expect(escapeLike("a_b%c\\")).toBe("a\\_b\\%c\\\\");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("D-2026-")).toBe("D-2026-");
  });
});
