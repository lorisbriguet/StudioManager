import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { isUntranslatedActivity } from "../lib/activityNudge";
import { ActivityRow } from "../pages/ProfilePage";
import { useAppStore } from "../stores/app-store";

// Untranslated activities print the same (usually French) name on English
// invoices — nudge in the editor where the fix happens.

describe("isUntranslatedActivity", () => {
  it("flags identical FR/EN names (trimmed)", () => {
    expect(isUntranslatedActivity({ name_fr: "Graphisme", name_en: "Graphisme" })).toBe(true);
    expect(isUntranslatedActivity({ name_fr: "Graphisme ", name_en: "Graphisme" })).toBe(true);
  });

  it("passes translated and empty names", () => {
    expect(isUntranslatedActivity({ name_fr: "Graphisme", name_en: "Graphic Design" })).toBe(false);
    expect(isUntranslatedActivity({ name_fr: "", name_en: "" })).toBe(false);
  });
});

describe("ActivityRow untranslated badge", () => {
  beforeEach(() => useAppStore.setState({ language: "EN" }));
  afterEach(cleanup);

  const activity = { id: 1, name_fr: "Graphisme", name_en: "Graphisme", sort_order: 0 };

  it("shows the badge while FR and EN are identical, live with edits", () => {
    render(
      <ActivityRow activity={activity} onSave={vi.fn()} onDelete={vi.fn()} removeLabel="Remove" />
    );
    expect(screen.getByLabelText(/same name in both languages/i)).toBeInTheDocument();

    // Typing a real translation clears the nudge immediately
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "Graphic Design" } });
    expect(screen.queryByLabelText(/same name in both languages/i)).not.toBeInTheDocument();
  });

  it("shows no badge for a translated activity", () => {
    render(
      <ActivityRow
        activity={{ ...activity, name_en: "Graphic Design" }}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        removeLabel="Remove"
      />
    );
    expect(screen.queryByLabelText(/same name in both languages/i)).not.toBeInTheDocument();
  });
});
