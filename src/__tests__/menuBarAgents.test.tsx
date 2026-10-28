import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MenuBarApp } from "../menubar/MenuBarApp";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";
import type { Agent, Group } from "../lib/agents";

function agent(group: Group, name: string, over: Partial<Agent> = {}): Agent {
  return {
    sessionId: `sess-${name}`,
    shortId: "abcd1234",
    pid: null,
    name,
    cwd: "/work/proj",
    kind: "background",
    status: "idle",
    state: null,
    waitingFor: null,
    startedAt: 0,
    group,
    quiet: null,
    project: null,
    model: null,
    modelLabel: null,
    ...over,
  };
}

const prompt = {
  question: "Run this command?",
  detail: "npm test",
  options: [
    { number: 1, label: "Yes" },
    { number: 2, label: "No" },
  ],
  fingerprint: "fp-1",
};

function serve(agents: Agent[]) {
  setInvokeHandler((cmd) => {
    if (cmd === "agents_list") return agents;
    if (cmd === "agents_prompt") return prompt;
    return null;
  });
}

describe("Menu bar Agents tab", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
    useAppStore.setState({ language: "EN" });
  });

  it("shows the prompt buttons inline for a Needs-you background agent", async () => {
    serve([agent("needs-you", "asker", { status: "waiting", waitingFor: "Run this command?" })]);
    render(<MenuBarApp />);
    expect(await screen.findByText("npm test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /No/ }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_answer")?.args).toMatchObject({
        shortId: "abcd1234",
        number: 2,
        fingerprint: "fp-1",
      }),
    );
  });

  it("opens another row in the main window by session id", async () => {
    serve([agent("working", "busy-one", { sessionId: "sess-77", shortId: "77777777" })]);
    render(<MenuBarApp />);
    fireEvent.click(await screen.findByRole("button", { name: /busy-one/ }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "menubar_open_main")?.args).toEqual({ agent: "sess-77", newAgent: false }),
    );
  });

  it("New agent asks the main window for the start form", async () => {
    serve([]);
    render(<MenuBarApp />);
    fireEvent.click(await screen.findByRole("button", { name: "New agent" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "menubar_open_main")?.args).toEqual({ agent: null, newAgent: true }),
    );
  });

  it("shows the empty state when there are no agents", async () => {
    serve([]);
    render(<MenuBarApp />);
    expect(await screen.findByText("No agents yet.")).toBeInTheDocument();
  });
});
