import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

function LocationProbe() {
  const { search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{search}</div>
      <button data-testid="go-started" onClick={() => navigate("/agents?started=beef0001")} />
    </>
  );
}
import { AgentsPage } from "../pages/AgentsPage";
import { StartAgentForm, slugifyName, typedName } from "../components/agents/StartAgentForm";
import { ConfirmHost } from "../components/ui/ConfirmDialog";
import { isInside } from "../lib/agents";
import { useAppStore } from "../stores/app-store";
import { emit } from "../__mocks__/tauri-event";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Agent, Group } from "../lib/agents";
import { logError } from "../lib/log";

vi.mock("../lib/log", () => ({ logError: vi.fn(() => Promise.resolve()) }));

// The Inbox and Needs you tabs read the database through these hooks.
const capturesMock = vi.hoisted(() => ({ newCaptures: [] as unknown[], briefs: [] as unknown[] }));
const needsMock = vi.hoisted(() => ({ open: [] as unknown[] }));
const linksMock = vi.hoisted(() => ({ links: [] as unknown[] }));
vi.mock("../db/hooks/useNeedsYou", () => ({
  useOpenEntries: () => ({ data: needsMock.open }),
  useNeedsYouCount: () => needsMock.open.length + capturesMock.briefs.length,
  useAloneEntries: () => ({ data: [] }),
  useAnswerEntry: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useReopenEntry: () => ({ mutate: vi.fn() }),
  useAddDecision: () => ({ mutate: vi.fn() }),
  useSendBack: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("../db/hooks/useTaskAgents", () => ({
  useOpenLinks: () => ({ data: linksMock.links }),
  useAcceptResult: () => ({ mutate: vi.fn() }),
}));
vi.mock("../db/hooks/useCaptures", () => ({
  useCaptures: () => ({ data: capturesMock.newCaptures, isLoading: false }),
  useBriefEntries: () => ({ data: capturesMock.briefs, isLoading: false }),
  useDismissCapture: () => ({ mutate: vi.fn() }),
  useRestoreCapture: () => ({ mutate: vi.fn() }),
  useBriefAgain: () => ({ mutate: vi.fn() }),
  useFileCaptureByHand: () => ({ mutate: vi.fn(), isPending: false }),
  useKeepAsTask: () => ({ mutate: vi.fn() }),
  useMarkStarted: () => ({ mutate: vi.fn() }),
  useSetBrief: () => ({ mutate: vi.fn() }),
}));
vi.mock("../hooks/useStartAgentOn", () => ({
  useStartAgentOn: () => ({ enabled: true, start: vi.fn(async () => false) }),
}));
vi.mock("../hooks/useHubs", () => ({ useHubList: () => [] }));
vi.mock("../db/hooks/useProjects", () => ({ useProjects: () => ({ data: [] }) }));
vi.mock("../db/hooks/useTasks", () => ({ useTasksByProject: () => ({ data: [] }) }));

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
    capturesMock.newCaptures = [];
    capturesMock.briefs = [];
    needsMock.open = [];
    linksMock.links = [];
  });

  it("lists groups in order and shows the project label", async () => {
    const list = [
      agent("done"),
      agent("idle", { quiet: "stale" }),
      agent("working", { model: "sonnet", project: label }),
      agent("needs-you", { project: label, waitingFor: "Run npm test?" }),
    ];
    setInvokeHandler((cmd) => (cmd === "agents_list" ? list : []));
    render(
      <MemoryRouter initialEntries={["/agents?tab=all"]}>
        <AgentsPage />
      </MemoryRouter>,
    );
    await screen.findByText("agent-needs-you");
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeInTheDocument();
    // Group rows: label then a plain count (no coloured Badge).
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Needs you1", "Working1", "Idle1", "Done1"]);
    // Every row keeps its project line; a needs-you row adds its status line under it.
    expect(screen.getByText("Run npm test?")).toBeInTheDocument();
    expect(screen.getAllByText("Org › Client › Project")).toHaveLength(2);
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

  it("selects an agent started from a task (?started=) once it is listed", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_list" ? [agent("working", { shortId: "beef0001" })] : []));
    render(
      <MemoryRouter initialEntries={["/agents?started=beef0001"]}>
        <AgentsPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?agent=sess-working"));
  });

  it("selects it too when ?started= arrives while the page is open", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_list" ? [agent("working", { shortId: "beef0001" })] : []));
    render(
      <MemoryRouter initialEntries={["/agents?tab=all"]}>
        <AgentsPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    await screen.findByText("agent-working");
    fireEvent.click(screen.getByTestId("go-started"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?agent=sess-working"));
  });

  const tabsSetup = (url: string, list: Agent[] = [agent("idle")]) => {
    setInvokeHandler((cmd) => (cmd === "agents_list" ? list : []));
    render(
      <MemoryRouter initialEntries={[url]}>
        <AgentsPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  };

  it("has the tabs Needs you, Inbox, All agents, in that order", async () => {
    tabsSetup("/agents?tab=all");
    await screen.findByText("agent-idle");
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["Needs you", "Inbox", "All agents"]);
  });

  it("shows Needs you without a tab parameter", async () => {
    tabsSetup("/agents");
    const panel = await screen.findByRole("tabpanel");
    expect(panel).toHaveTextContent("Nothing waits for you.");
    expect(screen.getByRole("tab", { name: "Needs you" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("agent-idle")).not.toBeInTheDocument();
  });

  it("shows All agents for ?tab=all", async () => {
    tabsSetup("/agents?tab=all");
    await screen.findByText("agent-idle");
    expect(screen.getByRole("tab", { name: "All agents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Select an agent to see its conversation.")).toBeInTheDocument();
  });

  it("leaves a watcher agent with an open Needs you entry out of the All agents Needs you group", async () => {
    needsMock.open = [{ id: 1, short_id: "feed0001", started_by: "watcher" }];
    tabsSetup("/agents?tab=all", [
      agent("needs-you", { shortId: "feed0001" }),
      agent("needs-you", { sessionId: "sess-hand", shortId: "feed0002", name: "agent-hand" }),
    ]);
    await screen.findByText("agent-hand");
    expect(screen.queryByText("agent-needs-you")).not.toBeInTheDocument();
  });

  it("keeps a hand-started agent with an open entry in the All agents Needs you group", async () => {
    needsMock.open = [{ id: 1, short_id: "feed0001", started_by: null }];
    tabsSetup("/agents?tab=all", [agent("needs-you", { shortId: "feed0001" })]);
    expect(await screen.findByText("agent-needs-you")).toBeInTheDocument();
  });

  it("keeps a watcher-linked agent with no open entry in the All agents Needs you group", async () => {
    linksMock.links = [{ kind: "task", item_id: 1, short_id: "feed0001", session_id: "sess-needs-you", started_by: "watcher" }];
    tabsSetup("/agents?tab=all", [agent("needs-you", { shortId: "feed0001" })]);
    expect(await screen.findByText("agent-needs-you")).toBeInTheDocument();
  });

  it("shows the Inbox for ?tab=inbox", async () => {
    tabsSetup("/agents?tab=inbox");
    expect(await screen.findByText(/Nothing captured/)).toBeInTheDocument();
    expect(screen.queryByText("agent-idle")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the Needs you panel for ?tab=needs-you", async () => {
    tabsSetup("/agents?tab=needs-you");
    const panel = await screen.findByRole("tabpanel");
    expect(panel).toHaveTextContent("Nothing waits for you.");
    expect(screen.getByRole("tab", { name: "Needs you" })).toHaveAttribute("aria-selected", "true");
  });

  it("?agent= wins over ?tab=inbox", async () => {
    tabsSetup("/agents?agent=sess-idle&tab=inbox");
    await screen.findByRole("heading", { level: 2, name: /Idle/ });
    expect(screen.getByRole("tab", { name: "All agents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/Nothing captured/)).not.toBeInTheDocument();
  });

  it("?new=1 wins over ?tab=inbox and opens the start form", async () => {
    tabsSetup("/agents?new=1&tab=inbox");
    expect(await screen.findByRole("heading", { level: 2, name: /Idle/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All agents" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab sets ?tab= with replace", async () => {
    tabsSetup("/agents?tab=all");
    await screen.findByText("agent-idle");
    fireEvent.click(screen.getByRole("tab", { name: "Inbox" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?tab=inbox");
    fireEvent.click(screen.getByRole("tab", { name: "Needs you" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?tab=needs-you");
    fireEvent.click(screen.getByRole("tab", { name: "All agents" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?tab=all");
  });

  it("shows plain counts on the Needs you and Inbox tabs", async () => {
    capturesMock.newCaptures = [{ id: 1 }, { id: 2 }];
    capturesMock.briefs = [{ capture_id: 3 }];
    needsMock.open = [{ id: 1 }, { id: 2 }];
    tabsSetup("/agents?tab=all");
    await screen.findByText("agent-idle");
    expect(screen.getByRole("tab", { name: "Needs you 3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Inbox 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All agents" })).toBeInTheDocument();
  });

  it("New agent from another tab goes to All agents and opens the form", async () => {
    tabsSetup("/agents?tab=inbox");
    fireEvent.click(await screen.findByRole("button", { name: "New agent" }));
    expect(screen.getByRole("tab", { name: "All agents" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Folder")).toBeInTheDocument();
  });

  it("says agents are off when the switch is off", () => {
    useAppStore.setState({ agentsEnabled: false });
    setInvokeHandler(() => {
      throw "Agents are switched off";
    });
    render(
      <MemoryRouter initialEntries={["/agents?tab=all"]}>
        <AgentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/switched off/i)).toBeInTheDocument();
    // The same shell as when it is on: the page title and the (disabled) New agent button.
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New agent" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("StartAgentForm", () => {
  beforeEach(() => {
    clearInvokedCommands();
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start_folders")
        return [
          { path: "/work/proj", label, trusted: true, home: false },
          { path: "/other", label: null, trusted: true, home: false },
        ];
      if (cmd === "agents_start") return "abcd1234";
      return null;
    });
  });

  async function setup() {
    render(<StartAgentForm onStarted={() => {}} onCancel={() => {}} />);
    // The folder field (a DropdownSelect) shows the first folder once they have loaded.
    await screen.findByText(/Org › Client › Project/);
  }

  it("slugifies names", () => {
    expect(slugifyName("Fix the login bug")).toBe("fix-the-login-bug");
    expect(slugifyName("--a  b!!c")).toBe("a-bc");
    expect(slugifyName("x".repeat(100))).toHaveLength(64);
  });

  it("a typed name turns spaces into - and drops characters a name cannot hold", () => {
    expect(typedName("Fix the Login")).toBe("Fix-the-Login");
    expect(typedName("café/bug #2")).toBe("cafbug-2");
    expect(typedName(" -x")).toBe("x");
    expect(typedName("a".repeat(70))).toHaveLength(64);
  });

  it("the name field never holds a space or a character a name cannot hold", async () => {
    await setup();
    const field = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "morning brief: v2" } });
    expect(field.value).toBe("morning-brief-v2");
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
        ownServer: false,
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

  it("shows a translated error inline and logs the command's error", async () => {
    await setup();
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start") throw "Folder is not trusted";
      return [];
    });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Do it" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't start the agent");
    expect(alert).not.toHaveTextContent("Folder is not trusted");
    expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.any(String), "Folder is not trusted");
  });
});

describe("StartAgentForm with a folder Claude does not trust yet", () => {
  function handler(home: boolean, trustError?: string) {
    clearInvokedCommands();
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start_folders")
        return [{ path: "/Users/me/Code", label: null, trusted: false, home }];
      if (cmd === "agents_trust_folder") {
        if (trustError) throw trustError;
        return "/Users/me/Code";
      }
      if (cmd === "agents_start") return "abcd1234";
      return null;
    });
  }

  async function fillAndStart() {
    render(
      <>
        <StartAgentForm onStarted={() => {}} onCancel={() => {}} />
        <ConfirmHost />
      </>,
    );
    await screen.findByText(/not trusted yet/);
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Do it" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    return screen.findByRole("dialog", { name: "Trust /Users/me/Code for Claude Code?" });
  }

  it("asks first, then trusts the folder and starts there", async () => {
    handler(false);
    const dialog = await fillAndStart();
    expect(dialog).toHaveTextContent(/every folder inside it/);
    fireEvent.click(screen.getByRole("button", { name: "Trust and start" }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "agents_start")).toBe(true));
    const cmds = invokedCommands.map((c) => c.cmd);
    expect(cmds.indexOf("agents_trust_folder")).toBeLessThan(cmds.indexOf("agents_start"));
    expect(invokedCommands.find((c) => c.cmd === "agents_trust_folder")?.args).toEqual({ folder: "/Users/me/Code" });
  });

  it("does nothing on Cancel", async () => {
    handler(false);
    const dialog = await fillAndStart();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invokedCommands.some((c) => c.cmd === "agents_trust_folder" || c.cmd === "agents_start")).toBe(false);
  });

  it("warns that the home folder covers everything in it", async () => {
    handler(true);
    const dialog = await fillAndStart();
    expect(dialog).toHaveTextContent(/home folder/);
  });

  it("does not start when trusting fails", async () => {
    handler(false, "Claude Code is saving its settings: try again");
    await fillAndStart();
    fireEvent.click(screen.getByRole("button", { name: "Trust and start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't trust the folder");
    expect(invokedCommands.some((c) => c.cmd === "agents_start")).toBe(false);
  });

  it("isInside matches the folder and what it holds, not siblings", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b/")).toBe(true);
    expect(isInside("/a/bc", "/a/b")).toBe(false);
    expect(isInside("/a", "/a/b")).toBe(false);
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
    fireEvent.click(screen.getByRole("option", { name: "Opus 5.5" }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "agents_switch_model")).toBe(true));
    await emit("agents:changed", [old, next]);
    const row = await screen.findByRole("button", { name: /new-agent/ });
    await waitFor(() => expect(row).toHaveAttribute("aria-current"));
    expect(screen.getByRole("button", { name: /old-agent/ })).not.toHaveAttribute("aria-current");
  });
});
