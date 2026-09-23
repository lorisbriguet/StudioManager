import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { UpdateChecker } from "../components/UpdateChecker";
import { useAppStore } from "../stores/app-store";

const check = vi.fn(async () => null);
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

beforeEach(() => {
  check.mockClear();
  useAppStore.setState({ language: "EN" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("UpdateChecker", () => {
  it("checks for updates on mount in the real build", async () => {
    vi.stubEnv("VITE_DEMO_BUILD", "");
    render(<UpdateChecker />);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("You're up to date")).toBeInTheDocument();
  });

  it("never checks in the demo build and says why", async () => {
    vi.stubEnv("VITE_DEMO_BUILD", "1");
    render(<UpdateChecker />);
    expect(screen.getByText("Demo build: updates are disabled.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(check).not.toHaveBeenCalled();
  });
});
