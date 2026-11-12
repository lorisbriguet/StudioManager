import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InboxTab } from "../components/agents/InboxTab";
import { useAppStore } from "../stores/app-store";
import type { CaptureRow } from "../db/queries/captures";

const hooks = vi.hoisted(() => ({
  captures: { new: [] as unknown[], filed: [] as unknown[], dismissed: [] as unknown[] } as Record<string, unknown[]>,
  dismiss: vi.fn(),
  restore: vi.fn(),
  briefAgain: vi.fn(),
  fileByHand: vi.fn(),
}));

vi.mock("../db/hooks/useCaptures", () => ({
  useCaptures: (status: string) => ({ data: hooks.captures[status], isLoading: false }),
  useDismissCapture: () => ({ mutate: hooks.dismiss }),
  useRestoreCapture: () => ({ mutate: hooks.restore }),
  useBriefAgain: () => ({ mutate: hooks.briefAgain }),
  useFileCaptureByHand: () => ({ mutate: hooks.fileByHand, isPending: false }),
}));
vi.mock("../db/hooks/useProjects", () => ({
  useProjects: () => ({
    data: [
      { id: 1, name: "Identity", status: "active" },
      { id: 2, name: "Poster tool", status: "active" },
      { id: 3, name: "Old work", status: "completed" },
    ],
  }),
}));
vi.mock("../db/hooks/useTasks", () => ({
  useTasksByProject: (projectId: number) => ({
    data:
      projectId === 1
        ? [
            { id: 10, project_id: 1, title: "Logo drafts", status: "todo" },
            { id: 11, project_id: 1, title: "Finished task", status: "done" },
          ]
        : [],
  }),
}));

function cap(over: Partial<CaptureRow> = {}): CaptureRow {
  return {
    id: 1,
    text: "Call the printer about the poster",
    source: "hotkey",
    status: "new",
    project_id: null,
    task_id: null,
    subtask_id: null,
    outcome: null,
    inbox_reason: null,
    brief_tries: 0,
    reminder_id: null,
    created_at: "2026-11-12 09:30:00",
    updated_at: "2026-11-12 09:30:00",
    project_name: null,
    task_title: null,
    subtask_title: null,
    ...over,
  };
}

function setup() {
  return render(
    <MemoryRouter>
      <InboxTab />
    </MemoryRouter>,
  );
}

describe("InboxTab", () => {
  beforeEach(() => {
    useAppStore.setState({ language: "EN" });
    hooks.captures = { new: [], filed: [], dismissed: [] };
    hooks.dismiss.mockReset();
    hooks.restore.mockReset();
    hooks.briefAgain.mockReset();
    hooks.fileByHand.mockReset();
  });

  it("lists new captures with their source", () => {
    hooks.captures.new = [cap()];
    setup();
    expect(screen.getByText("Call the printer about the poster")).toBeInTheDocument();
    expect(screen.getByText(/Shortcut/)).toBeInTheDocument();
  });

  it("says what to do when nothing was captured", () => {
    setup();
    expect(screen.getByText(/Nothing captured/)).toBeInTheDocument();
  });

  it("Dismiss calls the hook with the capture id", () => {
    hooks.captures.new = [cap({ id: 7 })];
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(hooks.dismiss).toHaveBeenCalledWith(7);
  });

  it("File… opens the form; submitting files with the project, the task and the title", async () => {
    hooks.captures.new = [cap({ id: 4, text: "Ask about logo variants\nand the deadline" })];
    setup();
    fireEvent.click(screen.getByRole("button", { name: "File…" }));
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    // Prefilled with the first line.
    expect(title.value).toBe("Ask about logo variants");
    // Open projects only.
    fireEvent.click(screen.getByLabelText("Project"));
    expect(screen.queryByRole("option", { name: "Old work" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "Identity" }));
    fireEvent.click(screen.getByLabelText("As a subtask of"));
    expect(screen.queryByRole("option", { name: "Finished task" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "Logo drafts" }));
    fireEvent.change(title, { target: { value: "Logo variants" } });
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(hooks.fileByHand).toHaveBeenCalledTimes(1);
    expect(hooks.fileByHand.mock.calls[0][0]).toEqual({ captureId: 4, projectId: 1, taskId: 10, title: "Logo variants" });
  });

  it("files without a task as a task of the project, and cuts the title at 80 characters", () => {
    hooks.captures.new = [cap({ id: 5, text: "x".repeat(120), project_id: 2 })];
    setup();
    fireEvent.click(screen.getByRole("button", { name: "File…" }));
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    expect(title.value).toHaveLength(80);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(hooks.fileByHand.mock.calls[0][0]).toEqual({ captureId: 5, projectId: 2, taskId: undefined, title: "x".repeat(80) });
  });

  it("a failed row shows the tag and Brief again", () => {
    hooks.captures.new = [cap({ id: 9, brief_tries: 3 })];
    setup();
    expect(screen.getByText("Briefing failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Brief again" }));
    expect(hooks.briefAgain).toHaveBeenCalledWith(9);
  });

  it("a no-project row shows the reason and Brief again", () => {
    hooks.captures.new = [cap({ id: 3, inbox_reason: "too vague" })];
    setup();
    expect(screen.getByText("No project fits: too vague")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Brief again" })).toBeInTheDocument();
  });

  it("a plain new row has no Brief again", () => {
    hooks.captures.new = [cap()];
    setup();
    expect(screen.queryByRole("button", { name: "Brief again" })).not.toBeInTheDocument();
  });

  it("Filed rows link to their project", async () => {
    hooks.captures.filed = [cap({ id: 2, status: "filed", project_id: 2, project_name: "Poster tool" })];
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Filed" }));
    const link = await screen.findByRole("link", { name: "Poster tool" });
    expect(link).toHaveAttribute("href", "/projects/2");
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("Dismissed rows have Restore", async () => {
    hooks.captures.dismissed = [cap({ id: 6, status: "dismissed" })];
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Dismissed" }));
    const row = (await screen.findByText("Call the printer about the poster")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Restore" }));
    expect(hooks.restore).toHaveBeenCalledWith(6);
    await waitFor(() => expect(hooks.dismiss).not.toHaveBeenCalled());
  });
});
