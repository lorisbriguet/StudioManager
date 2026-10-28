import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { emit } from "../__mocks__/tauri-event";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

type FakeTerm = {
  cols: number;
  rows: number;
  write: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDataCb: ((d: string) => void) | null;
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
};
const created: FakeTerm[] = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = vi.fn();
    dispose = vi.fn();
    onDataCb: ((d: string) => void) | null = null;
    constructor() {
      created.push(this as unknown as FakeTerm);
    }
    open() {}
    loadAddon() {}
    keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
    attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean) {
      this.keyHandler = h;
    }
    onData(cb: (d: string) => void) {
      this.onDataCb = cb;
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      const term = created[created.length - 1];
      term.cols = 100;
      term.rows = 30;
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TerminalPanel } from "../components/agents/TerminalPanel";
import { AGENTS_TERM, AGENTS_TERM_EXIT } from "../lib/agents";

const b64 = (s: string) => btoa(s);
const opened = () => invokedCommands.some((c) => c.cmd === "agents_term_open");

function pendingOpen() {
  const ctl = { resolve: (_n: number) => {} };
  setInvokeHandler((cmd) =>
    cmd === "agents_term_open"
      ? new Promise((r) => (ctl.resolve = r as (n: number) => void))
      : Promise.resolve(undefined),
  );
  return ctl;
}

describe("TerminalPanel", () => {
  beforeEach(() => {
    created.length = 0;
    clearInvokedCommands();
  });

  it("opens with fitted size and closes on unmount", async () => {
    setInvokeHandler(async (cmd) => (cmd === "agents_term_open" ? 7 : undefined));
    const { unmount } = render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await waitFor(() =>
      expect(invokedCommands).toContainEqual({
        cmd: "agents_term_open",
        args: { shortId: "abcd1234", cols: 100, rows: 30 },
      }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    unmount();
    await waitFor(() => expect(invokedCommands).toContainEqual({ cmd: "agents_term_close", args: { termId: 7 } }));
    await waitFor(() => expect(created[0].dispose).toHaveBeenCalled());
  });

  it("writes decoded data for its termId only, including early chunks", async () => {
    const ctl = pendingOpen();
    render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await waitFor(() => expect(opened()).toBe(true));
    await act(async () => {
      await emit(AGENTS_TERM, { termId: 3, data: b64("early") });
      await emit(AGENTS_TERM, { termId: 99, data: b64("other-early") });
    });
    await act(async () => ctl.resolve(3));
    const term = created[0];
    expect(term.write).toHaveBeenCalledTimes(1);
    expect(Array.from(term.write.mock.calls[0][0] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode("early")),
    );
    await act(async () => {
      await emit(AGENTS_TERM, { termId: 99, data: b64("nope") });
      await emit(AGENTS_TERM, { termId: 3, data: b64("hi") });
    });
    expect(term.write).toHaveBeenCalledTimes(2);
    expect(Array.from(term.write.mock.calls[1][0] as Uint8Array)).toEqual([104, 105]);
    act(() => term.onDataCb?.("ls\r"));
    expect(invokedCommands).toContainEqual({ cmd: "agents_term_write", args: { termId: 3, data: "ls\r" } });
  });

  it("Shift+Enter adds a line, plain Enter is left to xterm", async () => {
    setInvokeHandler((cmd) => Promise.resolve(cmd === "agents_term_open" ? 4 : undefined));
    render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await waitFor(() => expect(opened()).toBe(true));
    const term = created[0];
    await waitFor(() => expect(term.keyHandler).not.toBeNull());
    const key = (type: string, shiftKey: boolean) =>
      new KeyboardEvent(type, { key: "Enter", shiftKey });
    await waitFor(() => {
      clearInvokedCommands();
      expect(term.keyHandler?.(key("keydown", true))).toBe(false);
      expect(invokedCommands).toContainEqual({ cmd: "agents_term_write", args: { termId: 4, data: "\x1b\r" } });
    });
    clearInvokedCommands();
    expect(term.keyHandler?.(key("keyup", true))).toBe(false);
    expect(term.keyHandler?.(key("keydown", false))).toBe(true);
    expect(invokedCommands.some((c) => c.cmd === "agents_term_write")).toBe(false);
  });

  it("shows open error", async () => {
    setInvokeHandler(async (cmd) => {
      if (cmd === "agents_term_open") throw "Too many terminals";
    });
    render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    expect(await screen.findByText(/Too many terminals/)).toBeTruthy();
  });

  it("shows closed on exit and stops writing", async () => {
    setInvokeHandler(async (cmd) => (cmd === "agents_term_open" ? 5 : undefined));
    render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await waitFor(() => expect(opened()).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await emit(AGENTS_TERM_EXIT, { termId: 5 });
    });
    expect(await screen.findByText("Terminal closed")).toBeTruthy();
    clearInvokedCommands();
    act(() => created[0].onDataCb?.("x"));
    expect(invokedCommands.some((c) => c.cmd === "agents_term_write")).toBe(false);
  });

  it("closes a terminal that opens after unmount", async () => {
    const ctl = pendingOpen();
    const { unmount } = render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await waitFor(() => expect(opened()).toBe(true));
    unmount();
    await act(async () => ctl.resolve(9));
    expect(invokedCommands).toContainEqual({ cmd: "agents_term_close", args: { termId: 9 } });
  });

  it("keeps only the newest early chunks while open is pending", async () => {
    const ctl = pendingOpen();
    render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await waitFor(() => expect(opened()).toBe(true));
    await act(async () => {
      for (let i = 0; i < 300; i++) await emit(AGENTS_TERM, { termId: 3, data: b64(String(i)) });
    });
    await act(async () => ctl.resolve(3));
    const calls = created[0].write.mock.calls;
    expect(calls).toHaveLength(256);
    expect(new TextDecoder().decode(calls[0][0] as Uint8Array)).toBe("44");
    expect(new TextDecoder().decode(calls[255][0] as Uint8Array)).toBe("299");
  });

  it("ignores terminal events after an open error", async () => {
    setInvokeHandler(async (cmd) => {
      if (cmd === "agents_term_open") throw "Too many terminals";
    });
    render(<TerminalPanel shortId="abcd1234" onClose={() => {}} />);
    await screen.findByText(/Too many terminals/);
    await act(async () => {
      await emit(AGENTS_TERM, { termId: 1, data: b64("x") });
      await emit(AGENTS_TERM_EXIT, { termId: 1 });
    });
    expect(created[0].write).not.toHaveBeenCalled();
    expect(screen.queryByText("Terminal closed")).toBeNull();
  });
});
