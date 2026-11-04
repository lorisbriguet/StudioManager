import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { LoginNotice, loginState } from "../components/agents/LoginNotice";
import { MenuBarApp } from "../menubar/MenuBarApp";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";
import { AGENTS_LOGIN, type LoginStatus } from "../lib/agents";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

function signedIn(expiresAt: number | null, over: Partial<LoginStatus> = {}): LoginStatus {
  return { loggedIn: true, authMethod: "claude.ai", expiresAt, checkedAt: NOW, ...over };
}

function serve(status: LoginStatus | null, after: LoginStatus | null = status) {
  setInvokeHandler((cmd) => {
    if (cmd === "agents_login_status") return status;
    if (cmd === "agents_login_check") return after;
    if (cmd === "agents_list") return [];
    return null;
  });
}

describe("loginState", () => {
  it("is quiet far out, warns from 10 days, rounds days up", () => {
    expect(loginState(signedIn(NOW + 30 * DAY), NOW).kind).toBe("ok");
    expect(loginState(signedIn(NOW + 10 * DAY + 1), NOW).kind).toBe("ok");
    expect(loginState(signedIn(NOW + 10 * DAY), NOW)).toMatchObject({ kind: "soon", daysLeft: 10 });
    expect(loginState(signedIn(NOW + 3.2 * DAY), NOW)).toMatchObject({ kind: "soon", daysLeft: 4 });
    expect(loginState(signedIn(NOW + 1), NOW)).toMatchObject({ kind: "soon", daysLeft: 1 });
  });

  it("ends, signs out, or shows nothing without a date", () => {
    expect(loginState(signedIn(NOW), NOW).kind).toBe("ended");
    expect(loginState(signedIn(null, { loggedIn: false }), NOW).kind).toBe("signed-out");
    // An env token (the Mac mini's kind of sign-in) or an API key has no date.
    expect(loginState(signedIn(null, { authMethod: "oauth_token" }), NOW).kind).toBe("none");
    expect(loginState(null, NOW).kind).toBe("none");
  });
});

describe("LoginNotice", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
    useAppStore.setState({ language: "EN" });
  });

  it("shows a muted line on the page while more than 10 days are left", async () => {
    serve(signedIn(Date.now() + 40 * DAY));
    render(<LoginNotice quiet />);
    expect(await screen.findByText(/Claude sign-in until/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows nothing far out without `quiet` (the menu bar)", async () => {
    serve(signedIn(Date.now() + 40 * DAY));
    const { container } = render(<LoginNotice />);
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "agents_login_status")).toBe(true));
    expect(container).toBeEmptyDOMElement();
  });

  it("warns with the days left, and Check again clears it after a new login", async () => {
    serve(signedIn(Date.now() + 4 * DAY - 60_000), signedIn(Date.now() + 30 * DAY));
    render(<LoginNotice />);
    expect(await screen.findByText(/Claude sign-in ends in 4 days/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("claude auth login");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByText(/ends in/)).toBeNull());
    expect(invokedCommands.some((c) => c.cmd === "agents_login_check")).toBe(true);
  });

  it("says one day in the singular", async () => {
    serve(signedIn(Date.now() + 3_600_000));
    render(<LoginNotice />);
    expect(await screen.findByText(/ends in 1 day \(/)).toBeInTheDocument();
  });

  it("is a danger alert once ended or signed out", async () => {
    serve(signedIn(Date.now() - DAY));
    const { unmount } = render(<LoginNotice />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Claude sign-in ended on");
    unmount();
    serve(signedIn(null, { loggedIn: false }));
    render(<LoginNotice />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Claude is signed out");
  });

  it("follows the poller's agents:login event", async () => {
    serve(null);
    render(<LoginNotice />);
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "agents_login_status")).toBe(true));
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => emit(AGENTS_LOGIN, signedIn(Date.now() + 2 * DAY)));
    expect(await screen.findByText(/ends in 2 days/)).toBeInTheDocument();
  });

  it("is in French when the app is", async () => {
    useAppStore.setState({ language: "FR" });
    serve(signedIn(Date.now() + 5 * DAY - 60_000));
    render(<LoginNotice />);
    expect(await screen.findByText(/La connexion Claude expire dans 5 jours/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vérifier" })).toBeInTheDocument();
  });

  it("shows in the menu bar Agents tab, even with no agents", async () => {
    serve(signedIn(Date.now() + 2 * DAY));
    render(<MenuBarApp />);
    expect(await screen.findByText(/Claude sign-in ends in 2 days/)).toBeInTheDocument();
    expect(screen.getByText("No agents yet.")).toBeInTheDocument();
  });
});
