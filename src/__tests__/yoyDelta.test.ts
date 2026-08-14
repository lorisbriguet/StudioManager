import { describe, it, expect } from "vitest";
import { yoyDelta } from "../lib/yoyDelta";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { KPIWidget } from "../components/dashboard/widgets";
import { useAppStore } from "../stores/app-store";

describe("yoyDelta", () => {
  it("computes the rounded percent change vs the previous year", () => {
    expect(yoyDelta(112, 100)).toBe(12);
    expect(yoyDelta(88, 100)).toBe(-12);
    expect(yoyDelta(100, 100)).toBe(0);
  });

  it("returns null when the previous year is zero (no meaningful delta)", () => {
    expect(yoyDelta(500, 0)).toBeNull();
  });

  it("uses the magnitude of a negative previous value as the base", () => {
    // net result -100 -> +50 is a +150% improvement
    expect(yoyDelta(50, -100)).toBe(150);
  });
});

describe("KPIWidget delta badge", () => {
  const renderKpi = (delta: number | null) => {
    useAppStore.setState({ language: "EN" });
    render(createElement(KPIWidget, { label: "Invoiced", value: "CHF 1.00", delta }));
  };

  it("shows a signed percentage vs last year", () => {
    renderKpi(12);
    expect(screen.getByText(/\+12% vs last year/)).toBeInTheDocument();
    cleanup();
    renderKpi(-5);
    expect(screen.getByText(/-5% vs last year/)).toBeInTheDocument();
    cleanup();
  });

  it("renders no badge when there is no comparable previous year", () => {
    renderKpi(null);
    expect(screen.queryByText(/vs last year/)).not.toBeInTheDocument();
    cleanup();
  });
});
