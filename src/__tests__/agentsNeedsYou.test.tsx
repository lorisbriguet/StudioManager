import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NeedsYouTab } from "../components/agents/NeedsYouTab";
import { useAppStore } from "../stores/app-store";
import type { BriefEntry } from "../db/queries/captures";

const hooks = vi.hoisted(() => ({
  entries: [] as unknown[],
  keepAsTask: vi.fn(),
  markStarted: vi.fn(),
  setBrief: vi.fn(),
  start: vi.fn(async (_t: unknown) => true),
}));

vi.mock("../db/hooks/useCaptures", () => ({
  useBriefEntries: () => ({ data: hooks.entries, isLoading: false }),
  useKeepAsTask: () => ({ mutate: hooks.keepAsTask }),
  useMarkStarted: () => ({ mutate: hooks.markStarted }),
  useSetBrief: () => ({ mutate: hooks.setBrief }),
}));
vi.mock("../hooks/useStartAgentOn", () => ({
  useStartAgentOn: () => ({ enabled: true, start: hooks.start }),
}));

const entry = (over: Partial<BriefEntry> = {}): BriefEntry => ({
  capture_id: 12,
  capture_text: "export presets should outline fonts",
  capture_created_at: "2026-11-12 09:30:00",
  kind: "task",
  item_id: 44,
  title: "Export presets",
  brief: "Outline fonts in the PDF preset.",
  project_id: 4,
  project_name: "Poster tool",
  ...over,
});

function setup(entries: BriefEntry[]) {
  hooks.entries = entries;
  return render(
    <MemoryRouter>
      <NeedsYouTab />
    </MemoryRouter>,
  );
}

describe("NeedsYouTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.start.mockImplementation(async () => true);
    useAppStore.setState({ language: "EN" });
  });

  it("shows the Briefs group with its count and one entry with project, words and brief", () => {
    setup([entry()]);
    expect(screen.getByRole("heading", { level: 2, name: /Briefs/ })).toHaveTextContent("Briefs1");
    expect(screen.getByText("Filed under Poster tool")).toBeInTheDocument();
    expect(screen.getByText(/export presets should outline fonts/)).toBeInTheDocument();
    expect(screen.getByText("Outline fonts in the PDF preset.")).toBeInTheDocument();
    expect(screen.getByText("Export presets")).toBeInTheDocument();
  });

  it("says nothing waits when there is no entry", () => {
    setup([]);
    expect(screen.getByText("Nothing waits for you.")).toBeInTheDocument();
  });

  it("Start an agent starts on the task, then marks the capture started", async () => {
    setup([entry()]);
    fireEvent.click(screen.getByRole("button", { name: "Start an agent" }));
    await waitFor(() => expect(hooks.markStarted).toHaveBeenCalledWith(12));
    expect(hooks.start).toHaveBeenCalledWith({ kind: "task", id: 44 });
  });

  it("starts on the subtask for a subtask entry", async () => {
    setup([entry({ kind: "subtask", item_id: 9 })]);
    fireEvent.click(screen.getByRole("button", { name: "Start an agent" }));
    await waitFor(() => expect(hooks.markStarted).toHaveBeenCalledWith(12));
    expect(hooks.start).toHaveBeenCalledWith({ kind: "subtask", id: 9 });
  });

  it("does not mark the capture started when the agent was not started", async () => {
    hooks.start.mockImplementation(async () => false);
    setup([entry()]);
    fireEvent.click(screen.getByRole("button", { name: "Start an agent" }));
    await waitFor(() => expect(hooks.start).toHaveBeenCalled());
    await Promise.resolve();
    expect(hooks.markStarted).not.toHaveBeenCalled();
  });

  it("Keep as a task keeps it", () => {
    setup([entry()]);
    fireEvent.click(screen.getByRole("button", { name: "Keep as a task" }));
    expect(hooks.keepAsTask).toHaveBeenCalledWith(12);
  });

  it("Open the brief shows the text in a textarea; blur saves a change, not an unchanged text", () => {
    setup([entry()]);
    fireEvent.click(screen.getByRole("button", { name: "Open the brief" }));
    const field = screen.getByRole("textbox");
    expect(field).toHaveValue("Outline fonts in the PDF preset.");
    fireEvent.blur(field);
    expect(hooks.setBrief).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Outline fonts everywhere." } });
    fireEvent.blur(field);
    expect(hooks.setBrief).toHaveBeenCalledWith({ kind: "task", id: 44, brief: "Outline fonts everywhere." });
  });

  it("Cmd+Enter saves a change once", () => {
    setup([entry()]);
    fireEvent.click(screen.getByRole("button", { name: "Open the brief" }));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "New words." } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    fireEvent.blur(field);
    expect(hooks.setBrief).toHaveBeenCalledTimes(1);
    expect(hooks.setBrief).toHaveBeenCalledWith({ kind: "task", id: 44, brief: "New words." });
  });

  it("an entry without a brief shows no brief text until opened", () => {
    setup([entry({ brief: null })]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the brief" }));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
