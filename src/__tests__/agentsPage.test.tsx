import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentsPage } from "../pages/AgentsPage";
import { StartAgentForm, slugifyName } from "../components/agents/StartAgentForm";
import { useAppStore } from "../stores/app-store";
import { emit } from "../__mocks__/tauri-event";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Agent, Group } from "../lib/agents";

const label = {
  orgId: "o1",
  orgName: "Org",
  clientName: "Client",
  projectId: 1,
  projectName: "Project",
  folder: "/work/proj",
};

function agent(group: Group, over: Partial<Agent> = {}): Agent {
  return {
    sessionId: `sess-${group}`,
    shortId: "abcd1234",
    pid: null,
    name: `agent-${group}`,
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

describe("AgentsPage", () => {
  beforeEach(() => {
    clearInvokedCommands();
    useAppStore.setState({ agentsEnabled: true });
  });

  it("lists groups in order and shows the project label", async () => {
    const list = [
      agent("done"),
      agent("idle", { quiet: "stale" }),
      agent("working", { model: "sonnet" }),
      agent("needs-you", { project: label, waitingFor: "Run npm test?" }),
    ];
    setInvokeHandler((cmd) => (cmd === "agents_list" ? list : []));
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );
    await screen.findByText("agent-needs-you");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Needs you", "Working", "Idle", "Done"]);
    expect(screen.getByText("Org › Client › Project")).toBeInTheDocument();
    expect(screen.getByText("Run npm test?")).toBeInTheDocument();
    expect(screen.getAllByText("proj").length).toBeGreaterThan(0);
    expect(screen.getByText("quiet")).toBeInTheDocument();
  });

  it("opens the start form for ?new=1 (from the menu bar panel)", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_list" ? [] : cmd === "agents_start_folders" ? [] : null));
    render(
      <MemoryRouter initialEntries={["/agents?new=1"]}>
        <AgentsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText("Task")).toBeInTheDocument();
  });

  it("says agents are off when the switch is off", () => {
    useAppStore.setState({ agentsEnabled: false });
    setInvokeHandler(() => {
      throw "Agents are switched off";
    });
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/switched off/i)).toBeInTheDocument();
  });
});

describe("StartAgentForm", () => {
  beforeEach(() => {
    clearInvokedCommands();
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start_folders")
        return [
          { path: "/work/proj", label },
          { path: "/other", label: null },
        ];
      if (cmd === "agents_start") return "abcd1234";
      return null;
    });
  });

  async function setup() {
    render(<StartAgentForm onStarted={() => {}} onCancel={() => {}} />);
    await screen.findByRole("option", { name: /Org › Client › Project/ });
  }

  it("slugifies names", () => {
    expect(slugifyName("Fix the login bug")).toBe("fix-the-login-bug");
    expect(slugifyName("--a  b!!c")).toBe("a-bc");
    expect(slugifyName("x".repeat(100))).toHaveLength(64);
  });

  it("starts an agent with folder, task, model and the followed name", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Fix the login bug" } });
    expect(screen.getByLabelText("Name")).toHaveValue("fix-the-login-bug");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_start")?.args).toEqual({
        folder: "/work/proj",
        task: "Fix the login bug",
        model: "sonnet",
        name: "fix-the-login-bug",
      }),
    );
  });

  it("stops following the task once the name is edited", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "mine" } });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Something else" } });
    expect(screen.getByLabelText("Name")).toHaveValue("mine");
  });

  it("disables submit for a task starting with a dash", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "-rf" } });
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("shows the command's error inline", async () => {
    await setup();
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start") throw "Folder is not trusted";
      return [];
    });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Do it" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Folder is not trusted")).toBeInTheDocument();
  });
});

describe("AgentsPage selection of a new agent", () => {
  beforeEach(() => {
    clearInvokedCommands();
    useAppStore.setState({ agentsEnabled: true });
  });

  it("selects the new agent once a model switch's short id shows up in the list", async () => {
    const old = agent("idle", { sessionId: "sess-old", shortId: "11111111", name: "old-agent" });
    const next = agent("working", { sessionId: "sess-new", shortId: "abcd1234", name: "new-agent" });
    setInvokeHandler((cmd) => {
      if (cmd === "agents_list") return [old];
      if (cmd === "agents_switch_model") return "abcd1234";
      if (cmd === "agents_conversation") return [];
      return null;
    });
    render(
      <MemoryRouter initialEntries={["/?agent=sess-old"]}>
        <AgentsPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByLabelText("Model"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Opus 5.5" }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "agents_switch_model")).toBe(true));
    await emit("agents:changed", [old, next]);
    const row = await screen.findByRole("button", { name: /new-agent/ });
    await waitFor(() => expect(row).toHaveAttribute("aria-current"));
    expect(screen.getByRole("button", { name: /old-agent/ })).not.toHaveAttribute("aria-current");
  });
});
