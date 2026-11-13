import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useAppStore } from "../stores/app-store";
import type { OpenLink } from "../db/queries/taskAgents";
import type { Agent } from "../lib/agents";

const links = vi.hoisted(() => ({ value: [] as OpenLink[] }));
vi.mock("../db/hooks/useTaskAgents", () => ({ useOpenLinks: () => ({ data: links.value }) }));

const watchAgents = vi.hoisted(() => vi.fn(async () => {}));
const listed = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("../lib/agents", async (orig) => ({
  ...(await orig<typeof import("../lib/agents")>()),
  watchAgents,
  listAgents: async () => listed.value,
}));

import { StageChip, StageWord } from "../components/project/StageChip";
import { stageVariant, waitingOnYou } from "../lib/stage";
import { useAgents } from "../components/agents/useAgents";
import { variantClasses } from "../components/ui/Badge";

const agent = (over: Partial<Agent>): Agent => ({
  sessionId: "sess-1", shortId: "abcd1234", pid: null, name: "Poster tool", cwd: "/tmp/x", kind: "background",
  status: "idle", state: null, waitingFor: null, startedAt: 0, group: "needs-you", quiet: null, project: null,
  model: null, modelLabel: null, ...over,
});

beforeEach(() => {
  useAppStore.setState({ language: "EN", agentsEnabled: true });
  links.value = [];
  listed.value = [];
  watchAgents.mockClear();
});
afterEach(cleanup);

describe("StageChip", () => {
  it.each([
    ["briefed", "Briefed", "neutral"],
    ["ready", "Ready", "info"],
    ["running", "Running", "accent"],
    ["to_check", "To check", "warning"],
  ] as const)("%s reads %s", (stage, label, variant) => {
    expect(stageVariant(stage)).toBe(variant);
    render(<StageChip kind="task" id={1} stage={stage} status="todo" />);
    const chip = screen.getByText(label);
    for (const c of variantClasses[variant].split(" ")) expect(chip.className).toContain(c);
  });

  it("shows nothing for a done item, no stage, or Agents off", () => {
    const { container, rerender } = render(<StageChip kind="task" id={1} stage="to_check" status="done" />);
    expect(container.textContent).toBe("");
    rerender(<StageChip kind="task" id={1} stage={null} status="todo" />);
    expect(container.textContent).toBe("");
    useAppStore.setState({ agentsEnabled: false });
    rerender(<StageChip kind="task" id={1} stage="briefed" status="todo" />);
    expect(container.textContent).toBe("");
  });

  it("running with an agent waiting for you reads waiting on you", async () => {
    links.value = [{ kind: "task", item_id: 1, short_id: "abcd1234", session_id: "sess-1" }];
    listed.value = [agent({})];
    render(<StageChip kind="task" id={1} stage="running" status="todo" />);
    expect(await screen.findByText("Running · waiting on you")).toBeTruthy();
  });

  it("running with a working agent reads only Running", async () => {
    links.value = [{ kind: "task", item_id: 1, short_id: "abcd1234", session_id: "sess-1" }];
    listed.value = [agent({ group: "working" })];
    render(<StageChip kind="task" id={1} stage="running" status="todo" />);
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(watchAgents).not.toHaveBeenCalled();
  });

  it("is a button when it has a click handler", () => {
    render(<StageChip kind="subtask" id={1} stage="ready" status="todo" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Ready" })).toBeTruthy();
  });
});

describe("waitingOnYou", () => {
  it("matches by short id while the session id is unknown, and by kind", () => {
    const l: OpenLink[] = [{ kind: "subtask", item_id: 3, short_id: "abcd1234", session_id: null }];
    expect(waitingOnYou({ kind: "subtask", id: 3 }, l, [agent({})])).toBe(true);
    expect(waitingOnYou({ kind: "task", id: 3 }, l, [agent({})])).toBe(false);
  });
});

describe("useAgents watch", () => {
  it("never calls agents_watch with watch: false", async () => {
    const { unmount } = renderHook(() => useAgents({ watch: false }));
    await Promise.resolve();
    expect(watchAgents).not.toHaveBeenCalled();
    unmount();
    renderHook(() => useAgents());
    expect(watchAgents).toHaveBeenCalled();
  });
});

describe("StageWord (calendar events)", () => {
  it("a to_check task event renders To check", () => {
    render(<StageWord stage="to_check" status="todo" />);
    expect(screen.getByText("To check")).toBeTruthy();
  });
  it("nothing for a done item", () => {
    const { container } = render(<StageWord stage="to_check" status="done" />);
    expect(container.textContent).toBe("");
  });
});
