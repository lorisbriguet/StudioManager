import { describe, it, expect } from "vitest";
import { calendarAgentTarget } from "../lib/agentStart";

describe("calendarAgentTarget", () => {
  it("maps task, subtask and deadline events to what an agent can work on", () => {
    expect(calendarAgentTarget({ type: "task", itemId: 7, projectId: 1 })).toEqual({ kind: "task", id: 7 });
    expect(calendarAgentTarget({ type: "subtask", itemId: 9, projectId: 1 })).toEqual({ kind: "subtask", id: 9 });
    expect(calendarAgentTarget({ type: "deadline", itemId: 1, projectId: 1 })).toEqual({ kind: "project", id: 1 });
  });

  it("gives nothing for invoice, quote, upkeep and renewal events", () => {
    for (const type of ["invoice", "quote", "upkeep", "renewal"]) {
      expect(calendarAgentTarget({ type, itemId: 3 })).toBeNull();
    }
    expect(calendarAgentTarget({ type: "task" })).toBeNull();
  });
});
