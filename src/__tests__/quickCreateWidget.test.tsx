import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QuickCreate } from "../components/dashboard/PlanningWidgets";
import { useAppStore } from "../stores/app-store";

afterEach(() => {
  cleanup();
  useAppStore.setState({ language: "EN" });
});

describe("Quick Create widget", () => {
  it.each([
    ["EN", ["Invoice", "Quote", "Expense", "Project"], ["New Invoice", "New Quote", "New Expense", "New Project"]],
    ["FR", ["Facture", "Offre", "Dépense", "Projet"], ["Nouvelle facture", "Nouvelle offre", "Nouvelle dépense", "Nouveau projet"]],
  ] as const)("shows short labels in %s, named in full", (language, labels, names) => {
    useAppStore.setState({ language });
    render(<MemoryRouter><QuickCreate /></MemoryRouter>);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(labels);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(names);
  });
});
