import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { setInvokeHandler } from "../__mocks__/tauri-api";

// An agent reply may carry a link it copied from a README or a web page.
// Clicking it must hand the URL to the system browser, never navigate the
// app's own webview away from tauri://localhost.
const shellOpen = vi.hoisted(() => vi.fn(async (_url: string) => {}));
// plugin-shell is aliased to the catch-all tauri-api mock: keep its other
// exports (setInvokeHandler), replace only `open`.
vi.mock("@tauri-apps/plugin-shell", async (orig) => ({
  ...(await orig<typeof import("../__mocks__/tauri-api")>()),
  open: shellOpen,
}));
vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));

import { Conversation } from "../components/agents/Conversation";
import { notify } from "../lib/notify";

function reply(text: string) {
  setInvokeHandler((cmd) => (cmd === "agents_conversation" ? [{ kind: "assistant", text, at: null }] : null));
}

/** Click like a user would and report whether the webview would have navigated. */
function click(el: HTMLElement, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(event);
  return !event.defaultPrevented;
}

describe("links in agent replies", () => {
  beforeEach(() => {
    shellOpen.mockClear();
  });

  it("open an https link in the browser and do not navigate", async () => {
    reply("See [the docs](https://evil.example/login) for details.");
    render(<Conversation sessionId="s1" working={false} />);
    const link = await screen.findByRole("link", { name: "the docs" });
    expect(click(link)).toBe(false);
    expect(shellOpen).toHaveBeenCalledWith("https://evil.example/login");
  });

  it("open a mailto link through the shell", async () => {
    reply("Write to [me](mailto:hello@example.com).");
    render(<Conversation sessionId="s1" working={false} />);
    const link = await screen.findByRole("link", { name: "me" });
    expect(click(link)).toBe(false);
    expect(shellOpen).toHaveBeenCalledWith("mailto:hello@example.com");
  });

  it("cmd-click does not navigate either", async () => {
    reply("[site](https://example.com)");
    render(<Conversation sessionId="s1" working={false} />);
    const link = await screen.findByRole("link", { name: "site" });
    expect(click(link, { metaKey: true })).toBe(false);
    expect(shellOpen).toHaveBeenCalledTimes(1);
  });

  it("a middle click does not navigate", async () => {
    reply("[site](https://example.com)");
    render(<Conversation sessionId="s1" working={false} />);
    const link = await screen.findByRole("link", { name: "site" });
    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("a relative, file or custom-scheme link goes nowhere", async () => {
    reply("[a](README.md) [b](file:///etc/passwd) [c](/settings) [d](vscode://open)");
    render(<Conversation sessionId="s1" working={false} />);
    // react-markdown already empties unsafe hrefs (file:, vscode:), so those
    // anchors are found by text rather than as links.
    for (const name of ["a", "b", "c", "d"]) {
      const link = (await screen.findByText(name)).closest("a")!;
      expect(click(link)).toBe(false);
    }
    expect(shellOpen).not.toHaveBeenCalled();
  });

  it("a failed open is reported, not thrown", async () => {
    shellOpen.mockRejectedValueOnce(new Error("not allowed"));
    reply("[site](https://example.com)");
    render(<Conversation sessionId="s1" working={false} />);
    const link = await screen.findByRole("link", { name: "site" });
    fireEvent.click(link);
    expect(shellOpen).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith("Couldn't open the link", expect.any(Error)));
  });
});
