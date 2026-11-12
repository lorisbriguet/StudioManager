import { describe, expect, it } from "vitest";
import { remindersProblemText, type RemindersProblem } from "./agents";
import { uiLabels as ui } from "../i18n/ui";

const p = (over: Partial<RemindersProblem>): RemindersProblem => ({
  kind: "other",
  list: "Inbox",
  account: "Cloud",
  message: "boom",
  ...over,
});

describe("remindersProblemText", () => {
  it("names the list and the account when the list is missing, in both languages", () => {
    expect(remindersProblemText(p({ kind: "not_found" }), ui.EN)).toBe(
      'Reminders list "Inbox" not found in your Cloud account',
    );
    expect(remindersProblemText(p({ kind: "not_found" }), ui.FR)).toBe(
      "Liste de rappels « Inbox » introuvable dans votre compte Cloud",
    );
  });

  it("keeps a timeout apart from a permission error", () => {
    const timeout = remindersProblemText(p({ kind: "timeout" }), ui.EN);
    const denied = remindersProblemText(p({ kind: "denied" }), ui.EN);
    expect(timeout).toBe("Reminders did not answer. StudioManager will try again.");
    expect(denied).toContain("Automation");
    expect(remindersProblemText(p({}), ui.EN)).toBe("boom");
  });
});
