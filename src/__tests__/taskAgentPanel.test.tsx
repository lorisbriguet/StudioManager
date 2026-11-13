import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import type { TaskAgent } from "../types/taskAgent";

const h = vi.hoisted(() => ({
  links: [] as unknown[],
  captured: false,
  setStage: vi.fn(),
  accept: vi.fn(),
  setBrief: vi.fn(),
}));
vi.mock("../db/hooks/useTaskAgents", () => ({
  useItemAgents: () => ({ data: h.links }),
  useWasCaptured: () => ({ data: h.captured }),
  useSetStage: () => ({ mutate: h.setStage }),
  useAcceptResult: () => ({ mutate: h.accept }),
}));
vi.mock("../db/hooks/useCaptures", () => ({ useSetBrief: () => ({ mutate: h.setBrief }) }));
vi.mock("../components/agents/useAgents", () => ({ useAgents: () => ({ agents: [], byGroup: {} }) }));

import { TaskAgentPanel } from "../components/project/TaskAgentPanel";

const link = (over: Partial<TaskAgent> = {}): TaskAgent => ({
  id: 1, task_id: 7, subtask_id: null, session_id: "sess-1", short_id: "abcd1234", name: "Contact sheet export",
  model: "opus", branch: null, pr_url: null, started_at: "2026-11-13 09:00:00", reported_at: null,
  ended_at: null, outcome: null, ...over,
});

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const show = (item: Parameters<typeof TaskAgentPanel>[0]["item"]) =>
  render(
    <MemoryRouter>
      <TaskAgentPanel kind="task" item={item} />
      <Where />
    </MemoryRouter>,
  );
const base = { id: 7, status: "todo", stage: null, brief: null, result: null };
const current = () => document.querySelector("[aria-current='step']")?.textContent;

beforeEach(() => {
  useAppStore.setState({ language: "EN", agentsEnabled: true });
  h.links = [];
  h.captured = false;
  Object.values(h).forEach((v) => typeof v === "function" && "mockClear" in v && v.mockClear());
});
afterEach(cleanup);

describe("TaskAgentPanel", () => {
  it("marks the step of each stage", () => {
    for (const [stage, label] of [["briefed", "Briefed"], ["running", "Running"], ["to_check", "To check"]] as const) {
      show({ ...base, stage });
      expect(current()).toBe(label);
      cleanup();
    }
    show({ ...base, status: "done", result: "x" });
    expect(current()).toBe("Done");
  });

  it("Ready shows in the Briefed step; Idea only when captured", () => {
    show({ ...base, stage: "ready" });
    expect(current()).toBe("Ready");
    expect(screen.queryByText("Idea")).toBeNull();
    cleanup();
    h.captured = true;
    show({ ...base, stage: "ready" });
    expect(screen.getByText("Idea")).toBeTruthy();
  });

  it("the select offers three options and sets the stage", () => {
    show({ ...base, stage: "briefed" });
    fireEvent.click(screen.getByRole("combobox", { name: "Stage" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["No stage", "Briefed", "Ready"]);
    fireEvent.click(screen.getByRole("option", { name: "Ready" }));
    expect(h.setStage).toHaveBeenCalledWith({ kind: "task", id: 7, stage: "ready" });
  });

  it("Running has no select", () => {
    show({ ...base, stage: "running" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("To check offers Accept and Clear stage", () => {
    show({ ...base, stage: "to_check" });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(h.accept).toHaveBeenCalledWith({ kind: "task", id: 7 });
    fireEvent.click(screen.getByRole("button", { name: "Clear stage" }));
    expect(h.setStage).toHaveBeenCalledWith({ kind: "task", id: 7, stage: null });
  });

  it("saves the brief on blur, only when it changed", () => {
    show({ ...base, stage: "briefed", brief: "Export contact sheets" });
    const box = screen.getByRole("textbox", { name: "Brief" });
    fireEvent.blur(box);
    expect(h.setBrief).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Export contact sheets as PDF" } });
    fireEvent.blur(box);
    expect(h.setBrief).toHaveBeenCalledWith({ kind: "task", id: 7, brief: "Export contact sheets as PDF" });
  });

  it("shows a link with its pull request, and opens the agent", () => {
    h.links = [link({ pr_url: "https://example.com/pr/1", branch: "feature/contact" })];
    show({ ...base, stage: "running" });
    expect(screen.getByRole("link", { name: "https://example.com/pr/1" })).toBeTruthy();
    expect(screen.getByText("feature/contact")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("where").textContent).toBe("/agents?agent=sess-1");
  });

  it("a link with no session id opens ?started=", () => {
    h.links = [link({ session_id: null })];
    show({ ...base, stage: "running" });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("where").textContent).toBe("/agents?started=abcd1234");
  });

  it("says when an agent ended without a result, and shows the result", () => {
    h.links = [link({ ended_at: "2026-11-13 09:30:00", outcome: "no_result" })];
    show({ ...base, stage: "to_check" });
    expect(screen.getByText("ended without a result")).toBeTruthy();
    expect(screen.getByText("No result yet")).toBeTruthy();
    cleanup();
    show({ ...base, stage: "to_check", result: "Done.\nSecond line" });
    expect(screen.getByText(/Second line/).className).toContain("whitespace-pre-wrap");
  });

  it("renders nothing while Agents is off, or with nothing to show", () => {
    useAppStore.setState({ agentsEnabled: false });
    const { container } = show({ ...base, stage: "briefed" });
    expect(container.querySelector("section")).toBeNull();
    useAppStore.setState({ agentsEnabled: true });
    cleanup();
    expect(show(base).container.querySelector("section")).toBeNull();
  });
});
