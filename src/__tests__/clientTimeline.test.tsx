import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ClientActivityEvent } from "../db/queries/clients";

const events: ClientActivityEvent[] = [
  { type: "quote", action: "draft", entity_id: 3, label: "DRAFT-d5f8c77d-5e10-4819-857b-6c882d3bd088", date: "2026-11-06" },
  { type: "invoice", action: "draft", entity_id: 9, label: "DRAFT-0a1b2c3d", date: "2026-11-05" },
  { type: "invoice", action: "paid", entity_id: 7, label: "2026-014", date: "2026-10-01" },
  { type: "project", action: "active", entity_id: 2, label: "DRAFT-looking project name", date: "2026-09-01" },
];

vi.mock("../db/queries/clients", async (orig) => ({
  ...(await orig<object>()),
  getClientActivity: vi.fn(async () => events),
}));

import { ClientTimeline } from "../components/ClientTimeline";
import { useAppStore } from "../stores/app-store";

afterEach(cleanup);

describe("ClientTimeline", () => {
  it("shows a draft invoice or quote as 'Draft', not its DRAFT-<uuid> placeholder (Rerun 6)", async () => {
    useAppStore.setState({ language: "EN" });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ClientTimeline clientId="c1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("2026-014")).toBeInTheDocument();
    expect(screen.queryByText(/DRAFT-[0-9a-f]/)).toBeNull();
    expect(screen.getAllByRole("link", { name: "Draft" })).toHaveLength(2);
    // A project keeps its name, whatever it looks like.
    expect(screen.getByText("DRAFT-looking project name")).toBeInTheDocument();
  });
});
