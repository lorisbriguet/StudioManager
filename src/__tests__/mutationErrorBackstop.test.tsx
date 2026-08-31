import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "../lib/queryClient";
import { notifyError } from "../lib/notifyError";

// Audit round 4: mutations without an onError handler failed silently
// (calendar drag/drop, client field saves, wiki auto-save...). The query
// client's MutationCache now backstops them with a user-visible error.

vi.mock("../lib/notifyError", () => ({
  notifyError: vi.fn(),
  getLabels: () => new Proxy({}, { get: (_t, k) => String(k) }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(notifyError).mockClear();
});

describe("mutation error backstop", () => {
  it("surfaces errors from mutations with no onError handler", async () => {
    const { result } = renderHook(
      () => useMutation({ mutationFn: async () => { throw new Error("boom"); } }),
      { wrapper }
    );
    result.current.mutate(undefined);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the mutation brings its own onError", async () => {
    const local = vi.fn();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => { throw new Error("boom"); },
          onError: local,
        }),
      { wrapper }
    );
    result.current.mutate(undefined);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(local).toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
