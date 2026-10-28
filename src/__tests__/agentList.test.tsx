import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentList } from "../components/agents/AgentList";
import type { Agent, Group } from "../lib/agents";

function agent(group: Group, name: string): Agent {
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
  };
}

const byGroup = (): Record<Group, Agent[]> => ({
  "needs-you": [],
  working: [agent("working", "busy-one")],
  idle: [],
  done: [agent("done", "old-one"), agent("done", "older-one")],
});

describe("AgentList", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("folds Done by default, keeps its count, and unfolds on click", () => {
    render(<AgentList byGroup={byGroup()} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("busy-one")).toBeInTheDocument();
    expect(screen.queryByText("old-one")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Done/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "Done" }).parentElement).toHaveTextContent("2");
    fireEvent.click(toggle);
    expect(screen.getByText("old-one")).toBeInTheDocument();
    expect(screen.getByText("older-one")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("agents.foldedGroups") ?? "null")).toEqual([]);
  });

  it("every group folds, and the choice is remembered", () => {
    const { unmount } = render(<AgentList byGroup={byGroup()} selectedId={null} onSelect={() => {}} />);
    const working = screen.getByRole("button", { name: /Working/ });
    expect(working).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(working);
    expect(screen.queryByText("busy-one")).toBeNull();
    unmount();
    render(<AgentList byGroup={byGroup()} selectedId={null} onSelect={() => {}} />);
    expect(screen.queryByText("busy-one")).toBeNull();
    expect(screen.getByRole("button", { name: /Working/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the selected done agent visible while folded", () => {
    render(<AgentList byGroup={byGroup()} selectedId="sess-old-one" onSelect={() => {}} />);
    expect(screen.getByText("old-one")).toBeInTheDocument();
    expect(screen.queryByText("older-one")).toBeNull();
  });
});
