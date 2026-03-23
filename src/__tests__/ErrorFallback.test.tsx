import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorFallback } from "../components/ErrorFallback";

describe("ErrorFallback", () => {
  it("displays the error message", () => {
    const error = new Error("Something broke");
    render(<ErrorFallback error={error} resetErrorBoundary={vi.fn()} />);
    expect(screen.getByText("Something broke")).toBeInTheDocument();
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
