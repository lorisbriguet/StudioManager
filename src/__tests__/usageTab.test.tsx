import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ProgressBar } from "../components/ui";
import { UsageTab } from "../menubar/UsageTab";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";
import type { Activity, UsageLimits } from "../lib/usage";
import { notify } from "../lib/notify";

vi.mock("../lib/notify", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// happy-dom has no layout, so ResponsiveContainer would render nothing.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>(async () => {}) };

// Local-time epochs so the tests hold in any time zone. 2026-10-28 is a Wednesday.
const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();

const limits: UsageLimits = {
  setUp: true,
  savedAt: NOW,
  meters: [
    {
      window: "five_hour",
      label: "5-hour window",
      percent: 62,
      resetsAt: at(28, 16, 40),
      pace: { projectedPercentAtReset: 88, hitsFullAt: null },
    },
    {
      window: "seven_day",
      label: "Weekly",
      percent: 81,
      resetsAt: at(30, 9, 0),
      pace: { projectedPercentAtReset: 120, hitsFullAt: at(29, 15, 40) },
    },
    { window: "seven_day_opus", label: "Opus", percent: 44, resetsAt: at(30, 9, 0), pace: null },
  ],
};

const activity: Activity = {
  days: [
    { date: "2026-10-27", byClient: { Alpha: 3000, Other: 1000 } },
    { date: "2026-10-28", byClient: { Alpha: 2000 } },
  ],
  clients: ["Alpha", "Other"],
  modelMix: "Mostly Opus 5.5 92%, Sonnet 5.5 8%",
  time: {
    today: [
      { client: "Alpha", minutes: 65, projects: [["Site", 35], ["App", 30]] },
      { client: "Other", minutes: 20, projects: [["Notes", 20]] },
    ],
    week: [{ client: "Alpha", minutes: 125, projects: [["Site", 125]] }],
  },
};

function serve(l: UsageLimits | null = limits, a: Activity | null = activity) {
  setInvokeHandler((cmd) => {
    if (cmd === "agents_usage_limits") return l;
    if (cmd === "agents_usage_activity") return a;
    return null;
  });
}

const calls = (cmd: string) => invokedCommands.filter((c) => c.cmd === cmd).length;

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN" });
  vi.useFakeTimers({ toFake: ["Date"] }); // only the clock; real timers keep waitFor working
  vi.setSystemTime(NOW);
  clipboard.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

afterEach(() => {
  setInvokeHandler(null);
  vi.useRealTimers();
});

describe("ProgressBar with a fill colour (usage meters)", () => {
  const fill = () => screen.getByRole("progressbar").firstElementChild as HTMLElement;

  it("clamps the value to 0-100 and shows a non-number as empty", () => {
    const { rerender } = render(<ProgressBar value={140} color="var(--color-accent)" aria-label="Weekly" />);
    expect(fill().style.width).toBe("100%");
    rerender(<ProgressBar value={-5} color="var(--color-accent)" aria-label="Weekly" />);
    expect(fill().style.width).toBe("0%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    rerender(<ProgressBar value={NaN} color="var(--color-accent)" aria-label="Weekly" />);
    expect(fill().style.width).toBe("0%");
  });
});

describe("UsageTab", () => {
  it("writes the meter percent the French way (space before %)", async () => {
    useAppStore.setState({ language: "FR" });
    serve();
    render(<UsageTab trailing={null} />);
    expect(await screen.findByText("62\u00a0% · réinitialisation 16:40", { normalizer: (s) => s })).toBeInTheDocument();
  });

  it("shows the meters with reset text and pacing", async () => {
    serve();
    render(<UsageTab trailing={null} />);
    expect(await screen.findByText("5-hour window")).toBeInTheDocument();
    expect(screen.getByText("62% · resets 16:40")).toBeInTheDocument();
    expect(screen.getByText("81% · resets Fri 09:00")).toBeInTheDocument();
    expect(screen.getByText("On pace for 88% at reset")).toBeInTheDocument();
    const hit = screen.getByText("On pace to hit 100% Thu 15:40");
    expect(hit.className).toContain("text-[var(--color-warning-text)]");
    expect(screen.getByText("Weekly, Opus")).toBeInTheDocument();
    expect(screen.queryByText(/On pace for 44/)).toBeNull();
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((b) => b.getAttribute("aria-valuenow"))).toEqual(["62", "81", "44"]);
    expect((bars[1].firstElementChild as HTMLElement).style.backgroundColor).toBe("var(--color-warning)");
  });

  it("shows the empty state when the status line is not set up", async () => {
    serve({ meters: [], setUp: false, savedAt: null });
    render(<UsageTab trailing={null} />);
    expect(await screen.findByText(/Set up plan limits in Settings/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(invokedCommands.find((c) => c.cmd === "menubar_open_main")?.args).toMatchObject({ settings: "agents" });
  });

  it("shows the model mix and the client legend", async () => {
    serve();
    render(<UsageTab trailing={null} />);
    expect(await screen.findByText("Mostly Opus 5.5 92%, Sonnet 5.5 8%")).toBeInTheDocument();
    const legend = document.querySelector("[data-legend]") as HTMLElement;
    expect(legend.textContent).toBe("AlphaOther");
  });

  it("switches between Today and Week", async () => {
    serve();
    render(<UsageTab trailing={null} />);
    expect(await screen.findByText("1 h 05")).toBeInTheDocument();
    expect(screen.getByText("35 min")).toBeInTheDocument();
    expect(screen.getByText("A guide from agent activity, not a timesheet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getAllByText("2 h 05")).toHaveLength(2); // client and its only project
    expect(screen.queryByText("1 h 05")).toBeNull();
  });

  it("copies the active period as plain text", async () => {
    serve();
    render(<UsageTab trailing={null} />);
    await screen.findByText("1 h 05");
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(clipboard.writeText).toHaveBeenCalledWith(
      "Alpha  1 h 05\n  Site  35 min\n  App  30 min\nOther  20 min\n  Notes  20 min",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("Alpha  2 h 05\n  Site  2 h 05");
  });

  it("says when copying failed", async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error("Clipboard blocked"));
    serve();
    render(<UsageTab trailing={null} />);
    await screen.findByText("1 h 05");
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith("Couldn't copy", expect.any(Error)));
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith("Copied"));
  });

  it("refreshes limits every 30 s and activity every 60 s, and stops on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    serve();
    const { unmount } = render(<UsageTab trailing={null} />);
    await act(async () => {});
    expect([calls("agents_usage_limits"), calls("agents_usage_activity")]).toEqual([1, 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect([calls("agents_usage_limits"), calls("agents_usage_activity")]).toEqual([2, 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect([calls("agents_usage_limits"), calls("agents_usage_activity")]).toEqual([3, 2]);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect([calls("agents_usage_limits"), calls("agents_usage_activity")]).toEqual([3, 2]);
  });

  it("does not stack a call while one is in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setInvokeHandler((cmd) => (cmd === "agents_usage_limits" ? new Promise(() => {}) : activity));
    render(<UsageTab trailing={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(calls("agents_usage_limits")).toBe(1);
  });

  it("renders when the engine answers nothing", async () => {
    serve(null, null);
    render(<UsageTab trailing={null} />);
    await waitFor(() => expect(calls("agents_usage_activity")).toBe(1));
    expect(screen.getByRole("button", { name: "Copy as text" })).toBeDisabled();
  });
});
