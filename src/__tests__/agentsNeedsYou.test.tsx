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
  open: [] as unknown[],
  alone: [] as unknown[],
  answer: vi.fn(),
  reopen: vi.fn(),
  dismiss: vi.fn(),
  addDecision: vi.fn(),
  sendBack: vi.fn(),
  accept: vi.fn(),
  send: vi.fn(async (_s: string, _t: string) => {}),
}));

vi.mock("../db/hooks/useNeedsYou", () => ({
  useOpenEntries: () => ({ data: hooks.open }),
  useAloneEntries: () => ({ data: hooks.alone }),
  useAnswerEntry: () => ({ mutate: hooks.answer, mutateAsync: hooks.answer }),
  useReopenEntry: () => ({ mutate: hooks.reopen }),
  useDismissEntry: () => ({ mutate: hooks.dismiss }),
  useAddDecision: () => ({ mutate: hooks.addDecision }),
  useSendBack: () => ({ mutate: hooks.sendBack, mutateAsync: hooks.sendBack }),
}));
vi.mock("../db/hooks/useTaskAgents", () => ({ useAcceptResult: () => ({ mutate: hooks.accept }) }));
vi.mock("../lib/agents", async (orig) => ({
  ...(await orig<typeof import("../lib/agents")>()),
  sendMessage: (s: string, t: string) => hooks.send(s, t),
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
    hooks.open = [];
    hooks.alone = [];
    hooks.send.mockImplementation(async () => {});
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

function resetNeeds() {
  vi.clearAllMocks();
  hooks.open = [];
  hooks.alone = [];
  hooks.send.mockImplementation(async () => {});
  hooks.answer.mockImplementation(async () => {});
  hooks.sendBack.mockImplementation(async () => {});
  useAppStore.setState({ language: "EN" });
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 5,
  kind: "decide",
  task_id: 44,
  subtask_id: null,
  link_id: 2,
  title: "Export presets",
  body: "Should the PDF preset embed fonts or outline them?",
  recommendation: "Outline",
  options: JSON.stringify(["Outline", "Embed"]),
  is_decision: 0,
  status: "open",
  answer: null,
  decided_by: null,
  reason: "The wiki says print files go out without fonts.",
  lead_state: null,
  check_passed: null,
  check_output: null,
  change_lines: null,
  touches: null,
  delivered_at: null,
  created_at: "2026-11-13 09:00:00",
  answered_at: null,
  item_title: "Export presets",
  project_id: 4,
  project_name: "Poster tool",
  short_id: "abcd1234",
  session_id: "sess-1",
  started_by: null,
  pr_url: null,
  ...over,
});

describe("Needs you: Decide", () => {
  beforeEach(resetNeeds);

  it("shows the question, the recommendation, its reason and one button per option", () => {
    hooks.open = [row()];
    setup([]);
    expect(screen.getByRole("heading", { level: 2, name: /Decide/ })).toHaveTextContent("Decide1");
    expect(screen.getByText("Should the PDF preset embed fonts or outline them?")).toBeInTheDocument();
    expect(screen.getByText(/Recommended: Outline/)).toBeInTheDocument();
    expect(screen.getByText(/print files go out without fonts/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Embed" })).toBeInTheDocument();
    expect(screen.queryByText("From the lead")).not.toBeInTheDocument();
  });

  it("says From the lead only once the lead has answered", () => {
    hooks.open = [row({ lead_state: "done" })];
    const { unmount } = setup([]);
    expect(screen.getByText("From the lead")).toBeInTheDocument();
    unmount();
    for (const state of ["waiting", "running", null]) {
      hooks.open = [row({ lead_state: state })];
      const r = setup([]);
      expect(screen.queryByText("From the lead")).not.toBeInTheDocument();
      r.unmount();
    }
  });

  it("a link with no session keeps the entry open and shows the error; Dismiss lets it go", async () => {
    hooks.open = [row({ session_id: null })];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(await screen.findByText("Couldn't send the message")).toBeInTheDocument();
    expect(hooks.send).not.toHaveBeenCalled();
    expect(hooks.answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(hooks.dismiss).toHaveBeenCalledWith(5);
  });

  it("an option sends the answer to the agent, then answers the entry", async () => {
    hooks.open = [row()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    await waitFor(() => expect(hooks.answer).toHaveBeenCalledWith({ id: 5, answer: "Outline", delivered: true }));
    expect(hooks.send).toHaveBeenCalledWith("sess-1", "Answer to your question: Outline");
    expect(hooks.addDecision).not.toHaveBeenCalled();
  });

  it("Answer in words sends the typed text", async () => {
    hooks.open = [row()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Answer in words" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Outline, but keep the logo live." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the answer" }));
    await waitFor(() => expect(hooks.answer).toHaveBeenCalledWith({ id: 5, answer: "Outline, but keep the logo live.", delivered: true }));
    expect(hooks.send).toHaveBeenCalledWith("sess-1", "Answer to your question: Outline, but keep the logo live.");
  });

  it("a refused send keeps the entry open and shows the error", async () => {
    hooks.send.mockImplementation(async () => {
      throw new Error("agent is at a prompt");
    });
    hooks.open = [row()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(await screen.findByText("Couldn't send the message")).toBeInTheDocument();
    expect(hooks.answer).not.toHaveBeenCalled();
    expect(screen.getByText("Should the PDF preset embed fonts or outline them?")).toBeInTheDocument();
  });

  it("a decision is written to the project's Decisions", async () => {
    hooks.open = [row({ is_decision: 1 })];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    await waitFor(() => expect(hooks.addDecision).toHaveBeenCalled());
    const arg = hooks.addDecision.mock.calls[0][0] as { projectId: number; date: string; text: string };
    expect(arg.projectId).toBe(4);
    expect(arg.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.text).toContain("Embed");
  });

  it("an entry with no agent session is answered without sending", async () => {
    hooks.open = [row({ session_id: null, short_id: null, link_id: null })];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    await waitFor(() => expect(hooks.answer).toHaveBeenCalledWith({ id: 5, answer: "Outline", delivered: false }));
    expect(hooks.send).not.toHaveBeenCalled();
  });

  it("a double click sends once", async () => {
    let release: () => void = () => {};
    hooks.answer.mockImplementation(() => new Promise<void>((res) => (release = res)));
    hooks.open = [row()];
    setup([]);
    const button = screen.getByRole("button", { name: "Outline" });
    fireEvent.click(button);
    await waitFor(() => expect(hooks.answer).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    fireEvent.click(button);
    release();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(hooks.send).toHaveBeenCalledTimes(1);
    expect(hooks.answer).toHaveBeenCalledTimes(1);
  });

  it("a failed record after a sent answer says so, and a retry records without sending again", async () => {
    hooks.answer.mockImplementationOnce(async () => {
      throw new Error("db locked");
    });
    hooks.open = [row()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(await screen.findByText(/Your answer was sent to the agent/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outline" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    await waitFor(() => expect(hooks.answer).toHaveBeenCalledTimes(2));
    expect(hooks.send).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(/Your answer was sent to the agent/)).not.toBeInTheDocument());
  });

  it("links to the agent when the entry has a session", () => {
    hooks.open = [row(), row({ id: 6, session_id: null })];
    setup([]);
    const links = screen.getAllByRole("link", { name: "Open the agent" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/agents?agent=sess-1");
  });

  it("ignores options that are not a list of words", () => {
    hooks.open = [row({ options: "not json", recommendation: null })];
    setup([]);
    expect(screen.getByRole("button", { name: "Answer in words" })).toBeInTheDocument();
  });
});

describe("Needs you: Check", () => {
  const check = (over: Record<string, unknown> = {}) =>
    row({
      id: 8,
      kind: "check",
      title: "Contact sheet export",
      body: "Contact sheet export works for up to 48 variants",
      recommendation: null,
      options: null,
      reason: null,
      change_lines: 42,
      check_passed: 1,
      touches: JSON.stringify(["migrations"]),
      pr_url: "https://example.com/pull/3",
      ...over,
    });
  beforeEach(resetNeeds);

  it("shows the result, the size, the check and what it touches", () => {
    hooks.open = [check()];
    setup([]);
    expect(screen.getByRole("heading", { level: 2, name: /Check/ })).toHaveTextContent("Check1");
    expect(screen.getByText("Contact sheet export works for up to 48 variants")).toBeInTheDocument();
    expect(screen.getByText(/42 changed lines/)).toBeInTheDocument();
    expect(screen.getByText(/Check passed/)).toBeInTheDocument();
    expect(screen.getByText(/Touches: migrations/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the pull request" })).toHaveAttribute("href", "https://example.com/pull/3");
  });

  it("says a failed check and no check command", () => {
    hooks.open = [check({ check_passed: 0 }), check({ id: 9, check_passed: null, pr_url: null })];
    setup([]);
    expect(screen.getByText(/Check failed/)).toBeInTheDocument();
    expect(screen.getByText(/No check command/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open the pull request" })).toHaveLength(1);
  });

  it("Accept accepts the result, then marks the entry done", () => {
    hooks.open = [check()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(hooks.accept).toHaveBeenCalledWith({ kind: "task", id: 44 });
    expect(hooks.answer).toHaveBeenCalledWith({ id: 8, answer: "Accepted", delivered: false });
  });

  it("Accept on a subtask accepts the subtask", () => {
    hooks.open = [check({ task_id: null, subtask_id: 9 })];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(hooks.accept).toHaveBeenCalledWith({ kind: "subtask", id: 9 });
  });

  it("Send back types the note into the worker and sets the stage back to Running", async () => {
    hooks.open = [check()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Add a second page above 48." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the note" }));
    await waitFor(() =>
      expect(hooks.sendBack).toHaveBeenCalledWith({ kind: "task", id: 44, entryId: 8, note: "Add a second page above 48.", delivered: true }),
    );
    expect(hooks.send).toHaveBeenCalledWith("sess-1", "Add a second page above 48.");
  });

  it("a failed record after a sent note shows the error and a retry does not send again", async () => {
    hooks.sendBack.mockImplementationOnce(async () => {
      throw new Error("db locked");
    });
    hooks.open = [check()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Again." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the note" }));
    expect(await screen.findByText(/Your answer was sent to the agent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    await waitFor(() => expect(hooks.sendBack).toHaveBeenCalledTimes(2));
    expect(hooks.send).toHaveBeenCalledTimes(1);
  });

  it("a refused Send back keeps the entry open and shows the error", async () => {
    hooks.send.mockImplementation(async () => {
      throw new Error("gone");
    });
    hooks.open = [check()];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Again." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the note" }));
    expect(await screen.findByText("Couldn't send the message")).toBeInTheDocument();
    expect(hooks.sendBack).not.toHaveBeenCalled();
  });

  it("Send back with a link but no session sends nothing, changes nothing and shows the error", async () => {
    hooks.open = [check({ session_id: null })];
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Again." } });
    fireEvent.click(screen.getByRole("button", { name: "Send the note" }));
    expect(await screen.findByText("Couldn't send the message")).toBeInTheDocument();
    expect(hooks.send).not.toHaveBeenCalled();
    expect(hooks.sendBack).not.toHaveBeenCalled();
  });

  it("a reopened alone row is listed under Check", () => {
    hooks.open = [check({ id: 11, kind: "alone", title: "Merged: check passed, 37 lines", body: "", change_lines: null, check_passed: null, pr_url: null })];
    setup([]);
    expect(screen.getByRole("heading", { level: 2, name: /Check/ })).toHaveTextContent("Check1");
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });
});

describe("Needs you: groups and Decided alone", () => {
  beforeEach(resetNeeds);

  it("orders the groups Decide, Check, Briefs, Decided alone", () => {
    hooks.open = [row(), row({ id: 8, kind: "check", options: null, recommendation: null })];
    hooks.alone = [row({ id: 20, kind: "alone", status: "answered", decided_by: "app", title: "Merged: check passed, 37 lines" })];
    setup([entry()]);
    const names = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(["Decide1", "Check1", "Briefs1", "Decided alone1"]);
  });

  it("everything_done_alone_is_listed", () => {
    hooks.alone = [
      row({ id: 20, kind: "alone", status: "answered", decided_by: "app", title: "Merged: check passed, 37 lines", reason: null }),
      row({ id: 21, kind: "decide", status: "answered", decided_by: "lead", title: "Answered from the wiki article Decisions", reason: "The wiki settles it." }),
    ];
    setup([]);
    expect(screen.getByText("Merged: check passed, 37 lines")).toBeInTheDocument();
    expect(screen.getByText("Answered from the wiki article Decisions")).toBeInTheDocument();
    expect(screen.getByText("The wiki settles it.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reopen" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Reopen" })[0]);
    expect(hooks.reopen).toHaveBeenCalledWith(20);
  });

  it("shows only Decided alone when it is all there is", () => {
    hooks.alone = [row({ id: 20, kind: "alone", status: "answered", decided_by: "app", title: "Restarted after a connection error" })];
    setup([]);
    expect(screen.queryByText("Nothing waits for you.")).not.toBeInTheDocument();
    expect(screen.getByText("Restarted after a connection error")).toBeInTheDocument();
  });
});
