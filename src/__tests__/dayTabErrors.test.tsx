import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DayTab } from "../menubar/DayTab";
import { setInvokeHandler, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Routines } from "../lib/routines";

const section = { id: "s1", name: "Morning", links: [{ label: "Docs", target: "/Users/me/gone" }] };
const routines: Routines = {
  sections: [section],
  routines: [
    {
      id: "r1",
      sectionId: "s1",
      title: "Hours",
      idleHint: "",
      kind: { kind: "command", program: "/bin/echo", args: [], cwd: "/tmp" },
      resultLink: null,
      schedule: null,
    },
  ],
};

describe("Day tab errors", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
  });

  it("says the Agents switch is off instead of showing no routines", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "routines_get" || cmd === "routines_runs") throw "Agents are switched off";
      if (cmd === "agents_list") return [];
      return null;
    });
    render(<DayTab />);
    expect(await screen.findByText(/Agents are switched off — turn them on/)).toBeInTheDocument();
    expect(screen.queryByText(/No routines yet/)).toBeNull();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("shows why the runs could not be read above the routines", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "routines_get") return routines;
      if (cmd === "routines_runs") throw "routine-runs.json is damaged (EOF); fix or delete it";
      if (cmd === "agents_list") return [];
      return null;
    });
    render(<DayTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent("routine-runs.json is damaged");
  });

  it("shows a section link that cannot be opened", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "routines_get") return routines;
      if (cmd === "routines_runs" || cmd === "agents_list") return [];
      if (cmd === "routines_open_link") throw "Not found: /Users/me/gone";
      return null;
    });
    render(<DayTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Docs" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found: /Users/me/gone");
  });
});
