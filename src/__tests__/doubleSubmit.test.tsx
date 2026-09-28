import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Database from "@tauri-apps/plugin-sql";
import { ClientsPage } from "../pages/ClientsPage";
import { TasksPage } from "../pages/TasksPage";
import { WikiPage } from "../pages/WikiPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Double-submit guards: a create mutation left "in flight" (its INSERT held
// open forever, like a slow/never-returning Tauri call) must not be
// re-triggered by a second click/Enter while it is still pending.

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

// A guarded second click/Enter never starts a second mutation, so there's
// nothing to await — but an UNguarded one starts a real async chain (through
// useMutation, the query fn, then db.execute()) that takes several
// microtask hops to reach db.execute(). A `waitFor` that stops polling the
// instant the count first reads 1 would pass before that straggler lands.
// Flushing a real macrotask drains the whole microtask queue first, so the
// assertion after it reflects the settled state either way.
function flush(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Holds every db.execute() (INSERT/UPDATE/DELETE) open forever once armed,
// recording the attempt so tests can assert exactly one was made. This is
// the simplest way to keep a real useMutation's isPending true indefinitely.
let holdExecute = false;
let originalExecute: typeof Database.prototype.execute;

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
  holdExecute = false;
  originalExecute = Database.prototype.execute;
  Database.prototype.execute = function (
    this: InstanceType<typeof Database>,
    sql: string,
    params?: unknown[]
  ) {
    if (holdExecute) {
      executedStatements.push({ sql, params: params ?? [] });
      return new Promise<{ rowsAffected: number; lastInsertId: number }>(() => {});
    }
    return originalExecute.call(this, sql, params);
  };
});

afterEach(() => {
  Database.prototype.execute = originalExecute;
  setSelectHandler(null);
  cleanup();
});

describe("ClientsPage quick-create", () => {
  beforeEach(() => {
    setSelectHandler(() => []);
  });

  it("does not create the client twice when Save is clicked again while the create is pending", async () => {
    renderPage(<ClientsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^new client$/i }));
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "ACME SA" },
    });

    holdExecute = true;
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveBtn);

    // Wait for the mutation to actually be in flight (button disabled)
    // before attempting the second click.
    await waitFor(() => expect(saveBtn).toBeDisabled());
    fireEvent.click(saveBtn);

    await flush();
    expect(
      executedStatements.filter((s) => s.sql.includes("INSERT INTO clients")).length
    ).toBe(1);
  });
});

describe("TasksPage Enter-to-create", () => {
  const project = {
    id: 1,
    client_id: "c1",
    name: "Brand Refresh",
    description: "",
    status: "active",
    start_date: null,
    deadline: null,
    notes: "",
    layout_config: null,
    folder_path: null,
    created_at: "",
    updated_at: "",
  };
  const task = {
    id: 1,
    project_id: 1,
    title: "Kickoff call",
    description: "",
    status: "todo",
    priority: "low",
    due_date: null,
    end_date: null,
    start_time: null,
    end_time: null,
    reminder: null,
    scheduled_start: null,
    scheduled_end: null,
    calendar_event_id: null,
    notes: "",
    planned_minutes: null,
    tracked_minutes: 0,
    workload_cells: "{}",
    workload_sort_order: 0,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };

  beforeEach(() => {
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM tasks t")) return [task];
      if (flat.includes("FROM projects")) return [project];
      return [];
    });
  });

  it("does not create the task twice when Enter is pressed again while the create is pending", async () => {
    renderPage(<TasksPage />);

    const input = await screen.findByPlaceholderText("New task...");
    fireEvent.change(input, { target: { value: "Send proofs" } });

    holdExecute = true;
    fireEvent.keyDown(input, { key: "Enter" });

    // Wait for the mutation to actually be in flight before pressing
    // Enter again with the same (never-cleared) text.
    await waitFor(() => {
      expect(
        executedStatements.some((s) => s.sql.includes("INSERT INTO tasks"))
      ).toBe(true);
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await flush();
    expect(
      executedStatements.filter((s) => s.sql.includes("INSERT INTO tasks")).length
    ).toBe(1);
  });
});

describe("WikiPage new-article button", () => {
  const article = {
    id: 1,
    folder_id: null,
    project_id: null,
    title: "Getting Started",
    content: "",
    sort_order: 0,
    created_at: "",
    updated_at: "",
    tags_csv: null,
    project_name: null,
  };

  beforeEach(() => {
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM wiki_articles a")) return [article];
      return [];
    });
  });

  it("does not create the article twice when New article is clicked again while the create is pending", async () => {
    renderPage(<WikiPage />);

    const newArticleBtn = await screen.findByRole("button", { name: /^new article$/i });

    holdExecute = true;
    fireEvent.click(newArticleBtn);

    await waitFor(() => expect(newArticleBtn).toBeDisabled());
    fireEvent.click(newArticleBtn);

    await flush();
    expect(
      executedStatements.filter((s) => s.sql.includes("INSERT INTO wiki_articles")).length
    ).toBe(1);
  });
});
