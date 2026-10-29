import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorFallback, WidgetErrorFallback } from "../components/ErrorFallback";
import { logError } from "../lib/log";

vi.mock("../lib/log", () => ({ logError: vi.fn(() => Promise.resolve()) }));

describe("ErrorFallback", () => {
  it("logs the error instead of showing its raw message", () => {
    const error = new Error("Something broke");
    render(<ErrorFallback error={error} resetErrorBoundary={vi.fn()} />);
    expect(screen.queryByText("Something broke")).not.toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Something broke"), expect.anything());
  });

  it("widget fallback retries the widget", () => {
    const reset = vi.fn();
    render(<WidgetErrorFallback error={new Error("x")} resetErrorBoundary={reset} />);
    expect(screen.getByText("This widget couldn't load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows a retry button", () => {
    render(<ErrorFallback error={new Error("fail")} resetErrorBoundary={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("calls resetErrorBoundary when retry is clicked", () => {
    const reset = vi.fn();
    render(<ErrorFallback error={new Error("fail")} resetErrorBoundary={reset} />);
    fireEvent.click(screen.getByRole("button"));
    expect(reset).toHaveBeenCalledOnce();
  });
});
