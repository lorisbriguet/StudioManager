import { describe, it, expect } from "vitest";
import { agentName, agentPrompt, isTrustedFolder, type AgentItem } from "../lib/agentStart";
import type { StartFolder } from "../lib/agents";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const project = { id: 4, name: "Studio Manager App", folder: "/work/sm" };
const TAIL =
  "Then tell me briefly what you found and ask me what to do. Don't change anything before I answer. " +
  "If the StudioManager tools aren't available, say so and ask me to describe the work.";

const subtask: AgentItem = {
  kind: "subtask",
  id: 297,
  title: "Start an agent from a task",
  task: { id: 44, title: "New Features" },
  project,
  orgId: "6kun0b",
};
const task: AgentItem = { kind: "task", id: 44, title: "New Features", project, orgId: "6kun0b" };
const proj: AgentItem = { kind: "project", id: 4, title: "Studio Manager App", project, orgId: "6kun0b" };

describe("agentPrompt", () => {
  it("names a subtask with its task, project and organisation", () => {
    expect(agentPrompt(subtask)).toBe(
      'Work on StudioManager subtask 297 "Start an agent from a task" (task 44 "New Features", project 4 "Studio Manager App", organisation 6kun0b). ' +
        "First read it and its context with the StudioManager tools: the task, its subtasks and notes, the project and its wiki. " +
        TAIL,
    );
  });

  it("names a task with its project", () => {
    expect(agentPrompt(task)).toBe(
      'Work on StudioManager task 44 "New Features" (project 4 "Studio Manager App", organisation 6kun0b). ' +
        "First read it and its context with the StudioManager tools: the task, its subtasks and notes, the project and its wiki. " +
        TAIL,
    );
  });

  it("names a project and asks for its open tasks", () => {
    expect(agentPrompt(proj)).toBe(
      'Work on StudioManager project 4 "Studio Manager App" (organisation 6kun0b). ' +
        "First read it and its context with the StudioManager tools: the project, its open tasks and its wiki. " +
        TAIL,
    );
  });

  it("keeps the title verbatim", () => {
    expect(agentPrompt({ ...task, title: '-Révision "Café"' })).toContain('task 44 "-Révision "Café""');
    expect(agentPrompt({ ...task, title: "-x" }).startsWith("-")).toBe(false);
  });
});

describe("agentName", () => {
  it("builds kind-id-title", () => {
    expect(agentName(subtask)).toBe("subtask-297-start-an-agent-from-a-task");
    expect(agentName(task)).toBe("task-44-new-features");
    expect(agentName(proj)).toBe("project-4-studio-manager-app");
  });

  it("drops accents and punctuation", () => {
    expect(agentName({ ...task, id: 1, title: "Révision « Café » d'été" })).toBe("task-1-revision-cafe-d-ete");
  });

  it("stays a valid name for long or empty titles", () => {
    const long = agentName({ ...task, id: 1, title: "word ".repeat(40) });
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(NAME_RE);
    expect(long.endsWith("-")).toBe(false);
    expect(agentName({ ...task, id: 1, title: "" })).toBe("task-1");
    expect(agentName({ ...task, id: 1, title: "!!!" })).toBe("task-1");
  });
});

describe("isTrustedFolder", () => {
  const f = (path: string, trusted: boolean): StartFolder => ({ path, label: null, trusted, home: false });
  it("is true inside a trusted entry", () => {
    expect(isTrustedFolder("/a/b/c", [f("/a/b", true)])).toBe(true);
    expect(isTrustedFolder("/a/b", [f("/a/b", true)])).toBe(true);
  });
  it("is false for untrusted entries, siblings or an empty list", () => {
    expect(isTrustedFolder("/a/b", [f("/a/b", false)])).toBe(false);
    expect(isTrustedFolder("/a/bc", [f("/a/b", true)])).toBe(false);
    expect(isTrustedFolder("/a/b", [])).toBe(false);
  });
});
