import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AgentList } from "../components/agents/AgentList";
import { groupAgents } from "../components/agents/useAgents";
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
    modelLabel: null,
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
    // The group row reads like Table.Group: label, then its plain count.
    expect(screen.getByRole("heading", { name: /^Done/ })).toHaveTextContent("Done2");
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

  it("orders Done latest first", () => {
    const old = { ...agent("done", "old"), startedAt: 1 };
    const recent = { ...agent("done", "recent"), startedAt: 3 };
    const middle = { ...agent("done", "middle"), startedAt: 2 };
    expect(groupAgents([old, recent, middle]).done.map((a) => a.name)).toEqual(["recent", "middle", "old"]);
  });

  it("keeps the selected done agent visible while folded", () => {
    render(<AgentList byGroup={byGroup()} selectedId="sess-old-one" onSelect={() => {}} />);
    expect(screen.getByText("old-one")).toBeInTheDocument();
    expect(screen.queryByText("older-one")).toBeNull();
  });
});

describe("AgentList flags", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const flag = (name: string, label = "Flag") => {
    fireEvent.contextMenu(screen.getByText(name));
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
  };

  it("a flagged Done agent moves to Flagged on top, and back when unflagged", () => {
    render(<AgentList byGroup={byGroup()} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    flag("old-one");
    const flagged = screen.getByRole("heading", { name: /^Flagged/ });
    expect(flagged).toHaveTextContent("Flagged1");
    expect(screen.getByRole("heading", { name: /^Done/ })).toHaveTextContent("Done1");
    expect(screen.getAllByRole("img", { name: "Flagged" })).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("agents.flagged") ?? "[]")).toEqual(["sess-old-one"]);
    flag("old-one", "Remove flag");
    expect(screen.queryByRole("heading", { name: /^Flagged/ })).toBeNull();
    expect(screen.getByRole("heading", { name: /^Done/ })).toHaveTextContent("Done2");
  });

  it("a flagged working agent stays in Working, with its flag", () => {
    render(<AgentList byGroup={byGroup()} selectedId={null} onSelect={() => {}} />);
    flag("busy-one");
    expect(screen.queryByRole("heading", { name: /^Flagged/ })).toBeNull();
    expect(screen.getByRole("heading", { name: /^Working/ })).toHaveTextContent("Working1");
    expect(screen.getByRole("img", { name: "Flagged" })).toBeInTheDocument();
  });

  it("follows a flag set in another window", () => {
    render(<AgentList byGroup={byGroup()} selectedId={null} onSelect={() => {}} />);
    act(() => {
      localStorage.setItem("agents.flagged", JSON.stringify(["sess-older-one"]));
      window.dispatchEvent(new StorageEvent("storage", { key: "agents.flagged" }));
    });
    expect(screen.getByRole("heading", { name: /^Flagged/ })).toHaveTextContent("Flagged1");
  });
});
