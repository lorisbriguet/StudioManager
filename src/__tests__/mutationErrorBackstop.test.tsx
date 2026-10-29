import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "../lib/queryClient";
import { notify } from "../lib/notify";
import { useAppStore } from "../stores/app-store";

// Audit round 4: mutations without an onError handler failed silently
// (calendar drag/drop, client field saves, wiki auto-save...). The query
// client's MutationCache now backstops them with a user-visible error.

vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(notify.error).mockClear();
  useAppStore.setState({ language: "EN" });
});

describe("mutation error backstop", () => {
  it("surfaces errors from mutations with no onError handler", async () => {
    const { result } = renderHook(
      () => useMutation({ mutationFn: async () => { throw new Error("boom"); } }),
      { wrapper }
    );
    result.current.mutate(undefined);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(notify.error).toHaveBeenCalledTimes(1);
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
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("shows the mutation's errorLabel, with the raw error as the cause", async () => {
    const err = new Error("SQLITE_CONSTRAINT");
    const { result } = renderHook(
      () => useMutation({ meta: { errorLabel: "error_save_invoice" }, mutationFn: async () => { throw err; } }),
      { wrapper }
    );
    result.current.mutate(undefined);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(notify.error).toHaveBeenCalledWith("Couldn't save the invoice", err);
  });
});
