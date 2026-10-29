import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { UpkeepPage } from "../pages/UpkeepPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
});
afterEach(cleanup);

describe("UpkeepPage tabs", () => {
  it("wires the active tab to its panel and moves with the arrow keys", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <UpkeepPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const [first, second] = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", first.id);
    expect(second).toHaveAttribute("tabindex", "-1");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", second.id);
  });
});
