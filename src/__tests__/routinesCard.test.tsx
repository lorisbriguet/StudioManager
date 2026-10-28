import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoutinesCard } from "../components/settings/RoutinesCard";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Routines } from "../lib/routines";

const ask = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false);
vi.mock("@tauri-apps/plugin-dialog", async (importOriginal) => ({ ...(await importOriginal<object>()), ask: (...a: unknown[]) => ask(...a) }));

const saved: Routines = {
  sections: [{ id: "s1", name: "Morning", links: [] }],
  routines: [
    {
      id: "r1",
      sectionId: "s1",
      title: "Hours",
      idleHint: "",
      kind: { kind: "command", program: "/bin/echo", args: ["a"], cwd: "/tmp" },
      resultLink: null,
      schedule: { time: "08:00", days: "daily" },
    },
  ],
};

function serve(initial: Routines, fail?: string) {
  setInvokeHandler((cmd, args) => {
    if (cmd === "routines_get") return initial;
    if (cmd === "agents_start_folders") return [{ path: "/work/proj", label: null }];
    if (cmd === "routines_save") {
      if (fail) throw new Error(fail);
      return args.routines;
    }
    return null;
  });
}

const saveCalls = () => invokedCommands.filter((c) => c.cmd === "routines_save");
const emptySection: Routines = { sections: [{ id: "s1", name: "Morning", links: [] }], routines: [] };

describe("RoutinesCard", () => {
  beforeEach(() => {
    clearInvokedCommands();
    ask.mockReset().mockResolvedValue(false);
  });

  it("adds a command routine and saves the exact structure", async () => {
    serve(emptySection);
    render(<RoutinesCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Add routine" }));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Backup" } });
    fireEvent.click(screen.getByRole("radio", { name: "Command" }));
    fireEvent.change(screen.getByLabelText(/^Program/), { target: { value: "/usr/bin/rsync" } });
    fireEvent.change(screen.getByLabelText(/^Arguments/), { target: { value: "-a\n\nsrc dir\n/dst" } });
    fireEvent.change(screen.getByLabelText(/^Working folder/), { target: { value: "/tmp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect(saveCalls()[0].args).toEqual({
      routines: {
        sections: [{ id: "s1", name: "Morning", links: [] }],
        routines: [
          {
            id: "",
            sectionId: "s1",
            title: "Backup",
            idleHint: "",
            kind: { kind: "command", program: "/usr/bin/rsync", args: ["-a", "src dir", "/dst"], cwd: "/tmp" },
            resultLink: null,
            schedule: null,
          },
        ],
      },
    });
  });

  it("refuses an empty program without saving", async () => {
    serve(emptySection);
    render(<RoutinesCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Add routine" }));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Backup" } });
    fireEvent.click(screen.getByRole("radio", { name: "Command" }));
    fireEvent.change(screen.getByLabelText(/^Working folder/), { target: { value: "/tmp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the program to run.")).toBeInTheDocument();
    expect(saveCalls()).toHaveLength(0);
  });

  it("edits a schedule", async () => {
    serve(saved);
    render(<RoutinesCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Hours" }));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("radio", { name: "Weekdays" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    const sent = saveCalls()[0].args.routines as Routines;
    expect(sent.routines[0].schedule).toEqual({ time: "09:30", days: "weekdays" });
    expect(sent.routines[0].id).toBe("r1");
  });

  it("shows the save error inline", async () => {
    serve(saved, "Program not found");
    render(<RoutinesCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Hours" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Program not found")).toBeInTheDocument();
  });

  it("deletes a routine only after confirming", async () => {
    serve(saved);
    render(<RoutinesCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Hours" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(saveCalls()).toHaveLength(0);
    ask.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete Hours" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect((saveCalls()[0].args.routines as Routines).routines).toEqual([]);
  });

  it("asks before deleting a section and its routines", async () => {
    serve(saved);
    ask.mockResolvedValue(true);
    render(<RoutinesCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Morning" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect(String(ask.mock.calls[0][0])).toContain("all its routines");
    expect(saveCalls()[0].args.routines).toEqual({ sections: [], routines: [] });
  });
});
