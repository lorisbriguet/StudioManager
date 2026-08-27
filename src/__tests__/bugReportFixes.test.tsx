import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAppStore } from "../stores/app-store";
import { SortableSubtaskRow } from "../components/ProjectDetailContent";

// App bug reports:
// #311 the calendar forgets the last selected view across launches
// #335 the subtask drag handle sometimes stays visible after the cursor
//      leaves (stale CSS :hover after dnd re-renders) — visibility must be
//      driven by explicit hover state the page can always clear

describe("#311 calendar view persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ language: "EN" });
  });

  it("persists the selected view and restores it on a fresh store load", async () => {
    useAppStore.getState().setCalendarView("dayGridMonth");
    expect(localStorage.getItem("calendarView")).toBe("dayGridMonth");
    vi.resetModules();
    const fresh = await import("../stores/app-store");
    expect(fresh.useAppStore.getState().calendarView).toBe("dayGridMonth");
  });

  it("defaults to the week view on a fresh profile", async () => {
    localStorage.clear();
    vi.resetModules();
    const fresh = await import("../stores/app-store");
    expect(fresh.useAppStore.getState().calendarView).toBe("timeGridWeek");
  });
});

describe("#335 subtask drag handle visibility", () => {
  afterEach(cleanup);

  function renderRow(hovered: boolean, onHoverChange = vi.fn()) {
    useAppStore.setState({ language: "EN" });
    const utils = render(
      <DndContext>
        <SortableContext items={[1]} strategy={verticalListSortingStrategy}>
          <SortableSubtaskRow id={1} hovered={hovered} onHoverChange={onHoverChange}>
            <span>subtask</span>
          </SortableSubtaskRow>
        </SortableContext>
      </DndContext>
    );
    return { ...utils, onHoverChange };
  }

  it("hides the handle unless its row is the hovered one", () => {
    renderRow(false);
    expect(screen.getByLabelText(/drag to reorder/i).className).toContain("opacity-0");
    cleanup();
    renderRow(true);
    expect(screen.getByLabelText(/drag to reorder/i).className).toContain("opacity-100");
  });

  it("reports hover enter and leave so the page can clear state deterministically", () => {
    const { onHoverChange } = renderRow(false);
    const row = screen.getByText("subtask").closest("div")!;
    fireEvent.mouseEnter(row);
    expect(onHoverChange).toHaveBeenCalledWith(1);
    fireEvent.mouseLeave(row);
    expect(onHoverChange).toHaveBeenCalledWith(null);
  });
});
