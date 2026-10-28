import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DayTab } from "../menubar/DayTab";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Routine, Routines, Run } from "../lib/routines";

function routine(id: string, title: string, over: Partial<Routine> = {}): Routine {
  return {
    id,
    sectionId: "s1",
    title,
    idleHint: "",
    kind: { kind: "command", program: "/bin/echo", args: [], cwd: "/tmp" },
    resultLink: null,
    schedule: null,
    ...over,
  };
}

function run(routineId: string, over: Partial<Run> = {}): Run {
  return {
    routineId,
    startedAt: 0,
    finishedAt: null,
    status: "running",
    message: null,
    agentShortId: null,
    scheduledFor: null,
    ...over,
  };
}

function serve(routines: Routines, runs: Run[]) {
  setInvokeHandler((cmd) => {
    if (cmd === "routines_get") return routines;
    if (cmd === "routines_runs") return runs;
    if (cmd === "agents_list") return [];
    return null;
  });
}

const section = { id: "s1", name: "Morning", links: [{ label: "Docs", target: "https://example.com" }] };
const at = (h: number, m: number) => new Date(2026, 9, 28, h, m).getTime();

describe("Day tab", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
  });

  it("shows sections, links and a status line per routine", async () => {
    serve(
      {
        sections: [section],
        routines: [
          routine("r1", "Idle one", { idleHint: "Every morning" }),
          routine("r2", "Busy one"),
          routine("r3", "Finished one"),
          routine("r4", "Broken one"),
        ],
      },
      [
        run("r2"),
        run("r3", { status: "done", finishedAt: at(8, 12) }),
        run("r4", { status: "failed", finishedAt: at(8, 12), message: "exit 2" }),
      ],
    );
    render(<DayTab />);
    expect(await screen.findByText("Morning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Docs" })).toBeInTheDocument();
    expect(screen.getByText("Every morning")).toBeInTheDocument();
    expect(screen.getByText("Running").className).toContain("info-text");
    expect(screen.getByText("Done at 08:12").className).toContain("success-text");
    expect(screen.getByText("Failed: exit 2").className).toContain("danger-text");
  });

  it("Run starts the routine by its id", async () => {
    serve({ sections: [section], routines: [routine("r1", "Hours")] }, []);
    render(<DayTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "routines_run")?.args).toEqual({ id: "r1" }));
  });

  it("a done routine with a result link offers Open result", async () => {
    serve(
      { sections: [section], routines: [routine("r1", "Hours", { resultLink: "https://example.com/out" })] },
      [run("r1", { status: "done", finishedAt: at(8, 12) })],
    );
    render(<DayTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Open result" }));
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "routines_open_result")?.args).toEqual({ id: "r1" }));
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });

  it("a section link opens by section id and index", async () => {
    serve({ sections: [section], routines: [routine("r1", "Hours")] }, []);
    render(<DayTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Docs" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "routines_open_link")?.args).toEqual({ sectionId: "s1", index: 0 }),
    );
  });

  it("an agent routine's Open goes to its agent in the main window", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "routines_get")
        return {
          sections: [section],
          routines: [
            routine("r1", "Draft", {
              kind: { kind: "agent", folder: "/tmp", model: "opus", name: "draft", prompt: { text: "go" } },
            }),
          ],
        };
      if (cmd === "routines_runs") return [run("r1", { agentShortId: "abcd1234" })];
      if (cmd === "agents_list") return [{ sessionId: "sess-1", shortId: "abcd1234", group: "working" }];
      return null;
    });
    render(<DayTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "menubar_open_main")?.args).toMatchObject({ agent: "sess-1" }),
    );
  });

  it("the empty state points to Settings", async () => {
    serve({ sections: [], routines: [] }, []);
    render(<DayTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Settings" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "menubar_open_main")?.args).toMatchObject({ settings: "agents" }),
    );
  });
});
