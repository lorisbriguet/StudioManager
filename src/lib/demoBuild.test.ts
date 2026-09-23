import { describe, it, expect, afterEach, vi } from "vitest";
import { isDemoBuild } from "./demoBuild";

afterEach(() => vi.unstubAllEnvs());

describe("isDemoBuild", () => {
  it("is false when the flag is absent", () => {
    vi.stubEnv("VITE_DEMO_BUILD", "");
    expect(isDemoBuild()).toBe(false);
  });

  it("is true only for the exact value 1", () => {
    vi.stubEnv("VITE_DEMO_BUILD", "1");
    expect(isDemoBuild()).toBe(true);
    vi.stubEnv("VITE_DEMO_BUILD", "true");
    expect(isDemoBuild()).toBe(false);
  });
});
