import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SettingRow, SettingsCard } from "../components/ui/Settings";

afterEach(cleanup);

describe("SettingsCard / SettingRow", () => {
  it("renders a titled card with its description", () => {
    render(
      <SettingsCard title="Calendar sync" desc="Pick the calendar to write to">
        <SettingRow label="Week starts on">x</SettingRow>
      </SettingsCard>
    );
    expect(screen.getByRole("heading", { level: 2, name: "Calendar sync" })).toBeInTheDocument();
    expect(screen.getByText("Pick the calendar to write to")).toBeInTheDocument();
  });

  it("without a title renders no header", () => {
    render(<SettingsCard><p>Time entries</p></SettingsCard>);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("links the row label to its control with htmlFor", () => {
    render(
      <SettingRow label="Persona" htmlFor="persona">
        <input id="persona" />
      </SettingRow>
    );
    expect(screen.getByLabelText("Persona")).toHaveAttribute("id", "persona");
  });
});
