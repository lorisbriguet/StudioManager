import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";
import { newEntityFor, requestNewItem, takeNewItemRequest } from "../lib/newEntity";
import { useNewItem } from "../hooks/useNewItem";
import { GlobalShortcuts } from "../components/GlobalShortcuts";
import { CommandPalette } from "../components/CommandPalette";
import { useAppStore } from "../stores/app-store";

// U2: Cmd+N and the palette's New actions share one map (lib/newEntity.ts).

vi.mock("../db/hooks/useClients", () => ({ useClients: () => ({ data: [] }) }));
vi.mock("../db/hooks/useProjects", () => ({ useProjects: () => ({ data: [] }) }));
vi.mock("../db/hooks/useInvoices", () => ({ useInvoices: () => ({ data: [] }) }));

/** A list page that opens its form on a new-item request. */
function FormPage({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  useNewItem(path, () => setOpen(true));
  return <div data-testid={open ? "form-open" : "form-closed"} />;
}

beforeEach(() => useAppStore.setState({ newTask: null, commandPaletteOpen: false }));
afterEach(cleanup);

describe("newEntityFor", () => {
  it("maps every list page to its new item", () => {
    expect(newEntityFor("/invoices")).toEqual({ kind: "route", to: "/invoices/new" });
    expect(newEntityFor("/quotes")).toEqual({ kind: "route", to: "/quotes/new" });
    for (const p of ["/clients", "/projects", "/expenses", "/income", "/wiki"]) {
      expect(newEntityFor(p)).toEqual({ kind: "form", path: p });
    }
    expect(newEntityFor("/tasks")).toEqual({ kind: "task", projectId: null });
    expect(newEntityFor("/projects/12")).toEqual({ kind: "task", projectId: 12 });
    expect(newEntityFor("/clients/")).toEqual({ kind: "form", path: "/clients" });
  });

  it("has nothing for pages without a new item", () => {
    expect(newEntityFor("/")).toBeNull();
    expect(newEntityFor("/upkeep")).toBeNull();
    expect(newEntityFor("/invoices/3/edit")).toBeNull();
  });
});

describe("useNewItem", () => {
  it("opens a page's form requested before the page mounted", () => {
    requestNewItem("/clients");
    render(<FormPage path="/clients" />);
    expect(screen.getByTestId("form-open")).toBeInTheDocument();
  });

  it("ignores a request for another page", () => {
    render(<FormPage path="/clients" />);
    requestNewItem("/projects");
    expect(screen.getByTestId("form-closed")).toBeInTheDocument();
    expect(takeNewItemRequest("/projects")).toBe(true);
  });
});

describe("Cmd+N", () => {
  function renderAt(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <GlobalShortcuts />
        <Routes>
          <Route path="/clients" element={<FormPage path="/clients" />} />
          <Route path="/tasks" element={<div />} />
          <Route path="/projects/:id" element={<div />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: "n", metaKey: true });
  }

  it("opens the form on the clients page", () => {
    renderAt("/clients");
    expect(screen.getByTestId("form-open")).toBeInTheDocument();
  });

  it("opens New task without a project on the tasks page", () => {
    renderAt("/tasks");
    expect(useAppStore.getState().newTask).toEqual({ projectId: null });
  });

  it("opens New task with the project preselected on a project page", () => {
    renderAt("/projects/7");
    expect(useAppStore.getState().newTask).toEqual({ projectId: 7 });
  });
});

describe("Palette New actions", () => {
  function renderPalette(path: string) {
    useAppStore.setState({ commandPaletteOpen: true });
    render(
      <MemoryRouter initialEntries={[path]}>
        <CommandPalette />
        <Routes>
          <Route path="/" element={<div />} />
          <Route path="/clients" element={<FormPage path="/clients" />} />
          <Route path="/invoices/new" element={<div data-testid="new-invoice" />} />
          <Route path="/projects/:id" element={<div />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("New client goes to Clients and opens its form", async () => {
    renderPalette("/");
    fireEvent.click(screen.getByText("New Client"));
    await waitFor(() => expect(screen.getByTestId("form-open")).toBeInTheDocument());
  });

  it("New invoice opens the invoice form", async () => {
    renderPalette("/");
    fireEvent.click(screen.getByText("New Invoice"));
    await waitFor(() => expect(screen.getByTestId("new-invoice")).toBeInTheDocument());
  });

  it("New task opens the task form, with the current project preselected", () => {
    renderPalette("/projects/4");
    fireEvent.click(screen.getByText("New Task"));
    expect(useAppStore.getState().newTask).toEqual({ projectId: 4 });
  });

  it("lists New task, quote, income and article", () => {
    renderPalette("/");
    for (const label of ["New Task", "New Quote", "New Income", "New article"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
