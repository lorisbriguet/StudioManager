import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInvokedCommands, invokedCommands } from "../__mocks__/tauri-api";
import { SHOW_FALLBACK_MS, showMainWindowWhenPainted } from "../lib/showMainWindow";

const readyCalls = () => invokedCommands.filter((c) => c.cmd === "main_ready");

describe("showMainWindowWhenPainted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearInvokedCommands();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("--color-bg");
  });

  it("tells the app once, after the first frames", () => {
    showMainWindowWhenPainted();
    expect(readyCalls()).toHaveLength(0);
    vi.advanceTimersByTime(SHOW_FALLBACK_MS + 10);
    expect(readyCalls()).toHaveLength(1);
  });

  it("still tells the app when no frame comes (hidden window)", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    showMainWindowWhenPainted();
    vi.advanceTimersByTime(SHOW_FALLBACK_MS);
    expect(readyCalls()).toHaveLength(1);
    raf.mockRestore();
  });

  it("waits for a second frame, so the page has been drawn", () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    showMainWindowWhenPainted();
    frames.shift()?.(0);
    expect(readyCalls()).toHaveLength(0);
    frames.shift()?.(16);
    expect(readyCalls()).toHaveLength(1);
    raf.mockRestore();
  });

  it("sends the chosen theme, so the native window takes its colours, not the Mac's", () => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.setProperty("--color-bg", "#111111");
    showMainWindowWhenPainted();
    vi.advanceTimersByTime(SHOW_FALLBACK_MS);
    expect(readyCalls()[0].args).toEqual({ dark: true, background: "#111111" });
  });
});

describe("main window config", () => {
  const windowOf = (file: string) =>
    (JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri", file), "utf8")) as {
      app: { windows: Record<string, unknown>[] };
    }).app.windows[0];

  // A JSON merge patch replaces the whole windows array: the demo must repeat these.
  it.each(["tauri.conf.json", "tauri.demo.conf.json"])("%s starts the window hidden, on a set background", (file) => {
    expect(windowOf(file)).toMatchObject({ visible: false, backgroundColor: "#ffffff" });
  });
});
