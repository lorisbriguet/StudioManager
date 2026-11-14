import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectAgentSettings } from "../components/project/ProjectAgentSettings";
import { useAppStore } from "../stores/app-store";
import type { Project } from "../types/project";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import { qk } from "../db/queryKeys";

const setSettings = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../db/queries/projects", async (orig) => ({
  ...(await orig<object>()),
  setProjectAgentSettings: (...a: unknown[]) => setSettings(...a),
}));

function project(extra: Partial<Project> = {}): Project {
  return {
    id: 4, client_id: "c1", name: "Poster tool", description: "", status: "active", start_date: null,
    deadline: null, notes: "", layout_config: null, folder_path: null, created_at: "", updated_at: "",
    check_command: null, merge_alone: 0, hub_project: 0, ...extra,
  };
}

function renderIt(p: Project, qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <ProjectAgentSettings project={p} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setSettings.mockClear();
  useAppStore.setState({ language: "EN" });
});
afterEach(cleanup);

describe("ProjectAgentSettings", () => {
  it("the merge switch is disabled, with its reason, on a hub's project", () => {
    renderIt(project({ hub_project: 1 }));
    expect(screen.getByRole("switch", { name: "The lead may merge small changes alone" })).toBeDisabled();
    expect(screen.getByText(/Not available: this is a hub's project/)).toBeTruthy();
  });

  it("shows Belongs to a hub on and disabled, with the hub's name, when the folder is in a hub's folder", async () => {
    useAppStore.setState({ agentsEnabled: true });
    setInvokeHandler((cmd) =>
      cmd === "hubs_counts"
        ? [{ id: "h1", name: "Demo hub", colour: "purple", folder: "/data/Demo-Hub/", program: "/bin/sh", args: [], problemKind: null, approved: true, waiting: 0, fresh: true, checkedAt: 1, problem: null, nextTryAt: null, paused: false, busy: false, offers: [] }]
        : null,
    );
    renderIt(project({ folder_path: "/data/demo-hub/poster" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Belongs to a hub" })).toBeDisabled());
    expect(screen.getByRole("switch", { name: "Belongs to a hub" })).toBeChecked();
    expect(screen.getByText("In the folder of Demo hub")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "The lead may merge small changes alone" })).toBeDisabled();
    useAppStore.setState({ agentsEnabled: false });
    setInvokeHandler(null);
  });

  it("leaves the switch free for a folder beside a hub's, with the same prefix", async () => {
    useAppStore.setState({ agentsEnabled: true });
    setInvokeHandler((cmd) =>
      cmd === "hubs_counts"
        ? [{ id: "h1", name: "Demo hub", colour: "purple", folder: "/data/hub", program: "/bin/sh", args: [], problemKind: null, approved: true, waiting: 0, fresh: true, checkedAt: 1, problem: null, nextTryAt: null, paused: false, busy: false, offers: [] }]
        : null,
    );
    const qc = new QueryClient();
    renderIt(project({ folder_path: "/data/hub-old" }), qc);
    // Wait for the hubs to be read and drawn, so the switch is judged with the hub known.
    await waitFor(() => expect(qc.getQueryData(qk.hubs.list)).toBeDefined());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("switch", { name: "Belongs to a hub" })).not.toBeDisabled();
    useAppStore.setState({ agentsEnabled: false });
    setInvokeHandler(null);
  });

  it("switches merge_alone and hub_project through the query", async () => {
    renderIt(project());
    fireEvent.click(screen.getByRole("switch", { name: "The lead may merge small changes alone" }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(4, { merge_alone: 1 }));
    fireEvent.click(screen.getByRole("switch", { name: "Belongs to a hub" }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(4, { hub_project: 1 }));
  });

  it("saves the check command on blur, only when it changed", async () => {
    renderIt(project({ check_command: "npm test" }));
    const field = screen.getByRole("textbox", { name: "Check command" });
    expect(field).toHaveValue("npm test");
    fireEvent.blur(field);
    expect(setSettings).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "npm run check" } });
    fireEvent.blur(field);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(4, { check_command: "npm run check" }));
  });

  it("says who runs the command", () => {
    renderIt(project());
    expect(screen.getByText("Run by the app in the agent's worktree when a worker finishes. Only you can set it.")).toBeTruthy();
  });

  it("shows the next project's command and saves nothing when the parent switches project", async () => {
    // The parent keys the component by project id, as ProjectDetailContent does.
    const qc = new QueryClient();
    const ui = (p: Project) => (
      <QueryClientProvider client={qc}>
        <ProjectAgentSettings key={p.id} project={p} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(project({ check_command: "npm test" })));
    expect(screen.getByRole("textbox", { name: "Check command" })).toHaveValue("npm test");
    rerender(ui(project({ id: 5, name: "Contact sheet export", check_command: null })));
    const field = screen.getByRole("textbox", { name: "Check command" });
    expect(field).toHaveValue("");
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(setSettings).not.toHaveBeenCalled();
  });
});
