import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NeedsYouTab } from "../components/agents/NeedsYouTab";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import { vi } from "vitest";

vi.mock("../db/hooks/useNeedsYou", () => ({
  useOpenEntries: () => ({ data: [] }),
  useAloneEntries: () => ({ data: [] }),
}));
vi.mock("../db/hooks/useCaptures", () => ({
  useBriefEntries: () => ({ data: [], isLoading: false }),
}));

const base = {
  paused: null,
  budget: null,
  percent: null,
  line: null,
  minutesOld: null,
  running: 0,
  cap: 3,
  wouldStart: null,
  reason: null,
  blockedItem: null,
  lead: null,
};
let status: unknown = null;

function show() {
  return render(
    <MemoryRouter>
      <NeedsYouTab />
    </MemoryRouter>,
  );
}

describe("the watcher line on the Needs you tab", () => {
  beforeEach(() => {
    useAppStore.setState({ language: "EN" });
    setInvokeHandler((cmd) => (cmd === "watcher_status" ? status : null));
  });
  afterEach(() => {
    cleanup();
    setInvokeHandler(null);
  });

  it("says why the watcher waits", async () => {
    status = { ...base, paused: "cap", running: 2, cap: 2 };
    show();
    expect(await screen.findByText("Paused: 2 of 2 workers running")).toBeTruthy();
  });

  it("uses the budget words when the budget pauses it", async () => {
    status = { ...base, paused: "budget", budget: "five_hour", percent: 83.2 };
    show();
    expect(await screen.findByText("Paused: the 5-hour window is at 83%")).toBeTruthy();
  });

  it("names the item it would start", async () => {
    status = { ...base, wouldStart: "Contact sheet export" };
    show();
    expect(await screen.findByText("Would start: Contact sheet export")).toBeTruthy();
  });

  it("says agent access is off instead of nothing ready", async () => {
    status = { ...base, paused: "access_off" };
    show();
    expect(await screen.findByText("Waiting: agent access is off for every organisation")).toBeTruthy();
  });

  it("says why the first Ready item cannot start", async () => {
    status = { ...base, paused: "not_startable", reason: "not_git", blockedItem: "Poster tool" };
    show();
    expect(await screen.findByText('Waiting: the folder of "Poster tool" is not a git folder')).toBeTruthy();
  });

  it("shows no line while a start is under way", async () => {
    status = { ...base, paused: "starting" };
    show();
    await waitFor(() => expect(screen.getByText("Nothing waits for you.")).toBeTruthy());
    expect(screen.queryByText(/Waiting|Would start|Nothing ready/)).toBeNull();
  });

  it("shows nothing while the watcher switch is off", async () => {
    status = { ...base, paused: "off" };
    show();
    await waitFor(() => expect(screen.getByText("Nothing waits for you.")).toBeTruthy());
    expect(screen.queryByText(/Paused|Would start|Nothing ready/)).toBeNull();
  });
});
