import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { uiLabels } from "../i18n/ui";
import { DropdownSelect } from "../components/ui/Dropdown";

// UI review A4: the calendar and backup lists loaded onFocus. Select is a
// <button>, which WebKit doesn't focus on click, so opening it showed only
// the placeholder. They now load when the menu opens.

vi.mock("../lib/demoBuild", () => ({ isDemoBuild: vi.fn(() => false) }));
vi.mock("../lib/appleCalendar", async (orig) => ({
  ...(await orig<typeof import("../lib/appleCalendar")>()),
  listWritableCalendars: vi.fn(async () => ["Work", "Home"]),
}));
vi.mock("../lib/backup", async (orig) => ({
  ...(await orig<typeof import("../lib/backup")>()),
  listBackups: vi.fn(async () => ["backup-2026-10-01", "backup-2026-10-02"]),
}));

import { listWritableCalendars } from "../lib/appleCalendar";
import { listBackups } from "../lib/backup";
import { SettingsPage } from "../pages/SettingsPage";

const t = uiLabels.EN;

function renderPage(category: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/settings?category=${category}`]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(listWritableCalendars).mockClear();
  vi.mocked(listBackups).mockClear();
  useAppStore.setState({ language: "EN", calendarName: "", backupPath: "/tmp/backups" });
  useOrgStore.getState().applyRegistry({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "Atelier", createdAt: "", prefs: null }] });
});
afterEach(cleanup);

describe("DropdownSelect onOpen", () => {
  it("fires each time the menu opens, with no focus event", () => {
    const onOpen = vi.fn();
    render(<DropdownSelect aria-label="Pick" options={[{ value: "a", label: "A" }]} value="a" onChange={() => {}} onOpen={onOpen} />);
    const trigger = screen.getByRole("combobox", { name: "Pick" });
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger); // close
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // open again
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe("Settings lists load when their menu opens", () => {
  it("the calendar list", async () => {
    renderPage("calendar");
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: t.target_calendar }));
    });
    expect(listWritableCalendars).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("option", { name: "Work" })).toBeInTheDocument();
  });

  it("the backup list", async () => {
    renderPage("backup");
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: t.select_backup }));
    });
    await waitFor(() => expect(listBackups).toHaveBeenCalled());
    expect(await screen.findByRole("option", { name: "2026-10-02" })).toBeInTheDocument();
  });
});

// UI review C10: sonner's region was named "Notifications alt+T" whatever the
// language. EN and FR both say "Notifications", so the label is swapped for
// the test to show it comes from ui.ts.
describe("Toaster region label", () => {
  it("comes from ui.ts", async () => {
    const { Toaster } = await import("../components/ui/Toaster");
    const labels = uiLabels.FR as Record<string, string>;
    const saved = labels.toast_region_label;
    labels.toast_region_label = "Avis";
    try {
      useAppStore.setState({ language: "FR" });
      render(<Toaster />);
      const region = document.querySelector("section[aria-live]");
      expect(region?.getAttribute("aria-label")).toMatch(/^Avis\b/);
    } finally {
      labels.toast_region_label = saved;
    }
  });
});

// A pick in a Select fires no input/change event: it must still mark a
// surrounding FormModal dirty, so a backdrop click doesn't discard the form.
describe("Select inside a FormModal", () => {
  it("a pick makes the backdrop stop closing the form", async () => {
    const { useState } = await import("react");
    const { FormModal } = await import("../components/ui/Form");
    const { Select } = await import("../components/ui/Select");
    useAppStore.setState({ language: "EN" });
    function Harness() {
      const [open, setOpen] = useState(true);
      const [v, setV] = useState("a");
      return (
        <FormModal open={open} title="Pick" submitLabel="Save" onSubmit={() => {}} onClose={() => setOpen(false)}>
          <Select aria-label="Kind" value={v} onChange={(e) => setV(e.target.value)}>
            <option value="a">Alpha</option>
            <option value="b">Beta</option>
          </Select>
        </FormModal>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
