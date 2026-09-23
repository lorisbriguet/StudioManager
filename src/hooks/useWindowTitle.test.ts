import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { useWindowTitle } from "./useWindowTitle";
import { windowTitles } from "../__mocks__/tauri-api";

afterEach(() => {
  cleanup();
  windowTitles.length = 0;
});

describe("useWindowTitle", () => {
  it("sets document.title and the native window title from the organisation name", async () => {
    renderHook(() => useWindowTitle("Label"));

    await waitFor(() => expect(windowTitles[windowTitles.length - 1]).toBe("StudioManager — Label"));
    expect(document.title).toBe("StudioManager — Label");
  });

  it("falls back to the plain app name when there is no active organisation", async () => {
    renderHook(() => useWindowTitle(""));

    await waitFor(() => expect(windowTitles[windowTitles.length - 1]).toBe("StudioManager"));
    expect(document.title).toBe("StudioManager");
  });

  it("updates the native window title again when the organisation name changes", async () => {
    const { rerender } = renderHook(({ name }) => useWindowTitle(name), {
      initialProps: { name: "Label" },
    });
    await waitFor(() => expect(windowTitles[windowTitles.length - 1]).toBe("StudioManager — Label"));

    rerender({ name: "Studio" });

    await waitFor(() => expect(windowTitles[windowTitles.length - 1]).toBe("StudioManager — Studio"));
    expect(document.title).toBe("StudioManager — Studio");
  });
});
