import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuickCreatePopup } from "../pages/CalendarPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// Calendar quick-create (double-click on a day): Enter in the task name must
// add the event, like every other small form in the app.

function renderPopup(onSubmit = vi.fn(), onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <QuickCreatePopup
        pos={{ top: 100, left: 300 }}
        date="2026-09-22"
        startTime={null}
        projects={[{ id: 7, name: "Brand Identity Refresh" }]}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    </QueryClientProvider>
  );
  return { onSubmit, onClose };
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("QuickCreatePopup Enter key", () => {
  it("adds the event on Enter when the title matches no existing task", () => {
    setSelectHandler(() => []); // project has no tasks → no suggestions
    const { onSubmit } = renderPopup();
    const input = screen.getByPlaceholderText("New task...");
    fireEvent.change(input, { target: { value: "Print proofing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(7, "Print proofing");
  });

  it("adds the event on Enter after suggestions were shown but no longer match", async () => {
    setSelectHandler((sql) =>
      /FROM tasks/i.test(sql) ? [{ id: 1, project_id: 7, title: "Logo Concepts", status: "todo" }] : []
    );
    const { onSubmit } = renderPopup();
    const input = screen.getByPlaceholderText("New task...");
    fireEvent.change(input, { target: { value: "Logo" } });
    await waitFor(() => expect(screen.getByText("Logo Concepts")).toBeTruthy());
    // Keep typing past the suggestion so nothing matches any more
    fireEvent.change(input, { target: { value: "Logo animation brief" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(7, "Logo animation brief");
  });

  it("still picks the first suggestion on Enter while one matches", async () => {
    setSelectHandler((sql) =>
      /FROM tasks/i.test(sql) ? [{ id: 1, project_id: 7, title: "Logo Concepts", status: "todo" }] : []
    );
    const { onSubmit } = renderPopup();
    const input = screen.getByPlaceholderText("New task...");
    fireEvent.change(input, { target: { value: "Logo" } });
    await waitFor(() => expect(screen.getByText("Logo Concepts")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    // The task is now the parent; Enter in the subtask field submits a subtask
    const sub = screen.getByPlaceholderText("New subtask...");
    fireEvent.change(sub, { target: { value: "Direction D" } });
    fireEvent.keyDown(sub, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(7, "Direction D", 1);
  });
});
