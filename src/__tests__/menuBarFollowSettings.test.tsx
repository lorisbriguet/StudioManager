import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useFollowAppSettings } from "../menubar/useFollowAppSettings";
import { useAppStore } from "../stores/app-store";

// The main window writes localStorage; the panel gets a `storage` event (another window's write).
const fromMainWindow = (key: string, value: string) => {
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
};

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ language: "EN", darkMode: false, themeId: "default-light" });
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
});

describe("menu bar panel follows the main window's settings", () => {
  it("picks up a language change without a reload", () => {
    renderHook(() => useFollowAppSettings());
    act(() => fromMainWindow("appLanguage", "FR"));
    expect(useAppStore.getState().language).toBe("FR");
  });

  it("picks up dark mode", () => {
    renderHook(() => useFollowAppSettings());
    act(() => fromMainWindow("darkMode", "true"));
    expect(useAppStore.getState().darkMode).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("picks up a theme, and going back to the default clears its colours", () => {
    renderHook(() => useFollowAppSettings());
    act(() => fromMainWindow("themeId", "nord"));
    expect(useAppStore.getState().themeId).toBe("nord");
    expect(document.documentElement.style.getPropertyValue("--color-sidebar")).not.toBe("");
    act(() => fromMainWindow("themeId", "default-light"));
    expect(useAppStore.getState().themeId).toBe("default-light");
    expect(document.documentElement.style.getPropertyValue("--color-sidebar")).toBe("");
  });

  it("ignores unrelated keys, re-reads on focus, and stops listening when unmounted", () => {
    const { unmount } = renderHook(() => useFollowAppSettings());
    localStorage.setItem("appLanguage", "FR");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "sidebarCollapsed", newValue: "true" }));
    });
    expect(useAppStore.getState().language).toBe("EN");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(useAppStore.getState().language).toBe("FR");
    unmount();
    act(() => fromMainWindow("appLanguage", "EN"));
    expect(useAppStore.getState().language).toBe("FR");
  });
});
