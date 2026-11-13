import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { useAppStore } from "../stores/app-store";

const h = vi.hoisted(() => ({ links: [] as unknown[] }));
vi.mock("../db/hooks/useTaskAgents", () => ({
  useItemAgents: () => ({ data: h.links }),
  useOpenLinks: () => ({ data: [] }),
  useWasCaptured: () => ({ data: false }),
  useSetStage: () => ({ mutate: vi.fn() }),
  useAcceptResult: () => ({ mutate: vi.fn() }),
}));
vi.mock("../db/hooks/useCaptures", () => ({ useSetBrief: () => ({ mutate: vi.fn() }) }));
vi.mock("../components/agents/useAgents", () => ({ useAgents: () => ({ agents: [], byGroup: {} }) }));

import { AgentResultButton } from "../components/project/StageChip";
import { TaskAgentPanel } from "../components/project/TaskAgentPanel";

type Sub = { id: number; status: string; stage: null | "running"; result: string | null };
function Row({ s }: { s: Sub }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <AgentResultButton id={s.id} stage={s.stage} status={s.status} result={s.result} onClick={() => setOpen(!open)} />
      {open && <TaskAgentPanel kind="subtask" item={s} />}
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAppStore.setState({ language: "EN", agentsEnabled: true });
  h.links = [];
});
afterEach(cleanup);

describe("AgentResultButton", () => {
  it("shows for a done subtask with a result and opens the panel with it", () => {
    render(<Row s={{ id: 3, status: "done", stage: null, result: "Exported 12 sheets" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Agent result" }));
    expect(screen.getByText("Exported 12 sheets")).toBeTruthy();
  });

  it("shows for a subtask with only an agent link", () => {
    h.links = [{ id: 1 }];
    render(<Row s={{ id: 3, status: "todo", stage: null, result: null }} />);
    expect(screen.getByRole("button", { name: "Agent result" })).toBeTruthy();
  });

  it("shows nothing without a result or link, while the chip shows, or with Agents off", () => {
    const { container, rerender } = render(<Row s={{ id: 3, status: "done", stage: null, result: null }} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Row s={{ id: 3, status: "todo", stage: "running", result: "x" }} />);
    expect(screen.queryByRole("button")).toBeNull();
    useAppStore.setState({ agentsEnabled: false });
    rerender(<Row s={{ id: 3, status: "done", stage: null, result: "x" }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
