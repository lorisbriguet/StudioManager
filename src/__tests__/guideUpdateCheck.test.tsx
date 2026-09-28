/**
 * The built-in user guide is seeded into an organisation's wiki once, when the
 * organisation is created. A release that adds guide articles therefore reaches
 * existing installs only if the owner presses "Reset guide" — so the app tells
 * them once, per organisation, that there is something to reset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGuideUpdateCheck } from "../hooks/useGuideUpdateCheck";
import { USER_GUIDE_VERSION, USER_GUIDE_TITLES } from "../db/seeds/user-guide";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { createNotification } from "../db/queries/notifications";

const select = vi.fn();
vi.mock("../db", () => ({ getDb: async () => ({ select }) }));
vi.mock("../db/queries/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Answers the hook's two queries: the User Guide folder, then its article titles. */
function guideWith(titles: string[] | null) {
  select.mockImplementation((sql: string) => {
    if (titles === null) return [];
    if (/FROM wiki_folders/i.test(sql)) return [{ id: 1 }];
    if (/FROM wiki_articles/i.test(sql)) return titles.map((title) => ({ title }));
    return [];
  });
}

const notifiedKey = () => useOrgStore.getState().orgKey("guideUpdateNotified");

beforeEach(() => {
  select.mockReset();
  vi.mocked(createNotification).mockReset().mockResolvedValue(1);
  localStorage.clear();
  useAppStore.setState({ language: "EN" });
  useOrgStore.setState({ activeId: "o1" });
});
afterEach(cleanup);

describe("useGuideUpdateCheck", () => {
  it("notifies once when the organisation's guide is missing an article this version adds", async () => {
    guideWith(USER_GUIDE_TITLES.filter((t) => t !== "Organisations"));

    renderHook(() => useGuideUpdateCheck(), { wrapper });

    await waitFor(() => expect(createNotification).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(createNotification).mock.calls[0][0];
    expect(arg.type).toBe("info");
    expect(arg.read).toBe(0);
    expect(arg.link).toBe("/settings?category=general");
    expect(arg.message).toMatch(/reset guide/i);
    expect(localStorage.getItem(notifiedKey())).toBe(String(USER_GUIDE_VERSION));
  });

  it("stays quiet when the guide already holds every article of this version", async () => {
    guideWith([...USER_GUIDE_TITLES]);

    renderHook(() => useGuideUpdateCheck(), { wrapper });

    await waitFor(() => expect(localStorage.getItem(notifiedKey())).toBe(String(USER_GUIDE_VERSION)));
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("stays quiet when the organisation has no User Guide folder", async () => {
    guideWith(null);

    renderHook(() => useGuideUpdateCheck(), { wrapper });

    await waitFor(() => expect(localStorage.getItem(notifiedKey())).toBe(String(USER_GUIDE_VERSION)));
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("does not look again once this organisation has been told", async () => {
    localStorage.setItem(notifiedKey(), String(USER_GUIDE_VERSION));
    guideWith(USER_GUIDE_TITLES.filter((t) => t !== "Organisations"));

    renderHook(() => useGuideUpdateCheck(), { wrapper });

    await waitFor(() => expect(select).not.toHaveBeenCalled());
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("tracks each organisation separately", async () => {
    localStorage.setItem("guideUpdateNotified:o1", String(USER_GUIDE_VERSION));
    useOrgStore.setState({ activeId: "o2" });
    guideWith(USER_GUIDE_TITLES.filter((t) => t !== "Organisations"));

    renderHook(() => useGuideUpdateCheck(), { wrapper });

    await waitFor(() => expect(createNotification).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem("guideUpdateNotified:o2")).toBe(String(USER_GUIDE_VERSION));
  });
});
