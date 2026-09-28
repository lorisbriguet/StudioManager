/**
 * Exercises QRBillCanvas's `paint` callback against the real swissqrbill
 * drawing code (unlike pdfGolden.test.tsx, which only records the `paint`
 * prop's existence — see the note in that file's @react-pdf/renderer mock).
 *
 * Mocks @react-pdf/renderer so `Canvas` actually *invokes* `paint` with a
 * recording painter double, so a broken slip (nothing drawn, or a drawing
 * exception) is something a test can catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { SwissQRBill } from "swissqrbill/pdf";

// Mutable state the hoisted @react-pdf/renderer mock reads/writes, plus the
// full list of drawing methods QRBillSvgRenderer's createDocWrapper
// delegates straight through to the painter (see
// src/components/invoice/QRBillSvgRenderer.tsx). Declared via vi.hoisted so
// it's initialized before vi.mock's factory runs, and so both the factory
// and the tests below share one source of truth for the method list.
const painterState = vi.hoisted(() => ({
  methods: [
    "moveTo", "lineTo", "lineWidth", "strokeOpacity", "dash", "undash",
    "strokeColor", "fillColor", "stroke", "fill", "rect", "save", "restore",
    "translate", "scale", "path", "fillAndStroke", "circle", "clip", "image",
    "fontSize", "font", "text",
  ] as const,
  calls: [] as Array<{ method: string; args: unknown[] }>,
  // Method name to throw on (simulates a drawing failure partway through).
  failOn: null as string | null,
}));

vi.mock("@react-pdf/renderer", () => {
  function makePainter() {
    const painter: Record<string, (...args: unknown[]) => void> = {};
    for (const method of painterState.methods) {
      painter[method] = (...args: unknown[]) => {
        painterState.calls.push({ method, args });
        if (painterState.failOn === method) {
          throw new Error(`painter.${method} failed`);
        }
      };
    }
    return painter;
  }

  return {
    // The real Canvas defers calling `paint` until react-pdf actually lays
    // out and renders to PDF. The test only cares that QRBillCanvas's paint
    // callback produces real drawing calls (or handles a failure), so this
    // stub invokes it immediately with the recording painter double.
    Canvas: ({
      paint,
    }: {
      paint: (painter: unknown, availableWidth: number, availableHeight: number) => unknown;
    }) => {
      paint(makePainter(), 595, 300);
      return null;
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

import { QRBillCanvas } from "../components/invoice/QRBillSvgRenderer";
import { buildQRBillData } from "../components/invoice/qr-bill";
import { useAppStore } from "../stores/app-store";
import { invoiceFixture, clientFixture, profileFixture } from "./fixtures/pdfFixtures";

const validData = buildQRBillData(invoiceFixture, clientFixture, profileFixture);

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  painterState.calls = [];
  painterState.failOn = null;
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("QRBillCanvas", () => {
  it("draws the QR slip via the painter and surfaces no error on success", () => {
    render(<QRBillCanvas data={validData} language="EN" />);

    // This is the assertion that would have caught the slip silently
    // failing to draw: pdfGolden's mock never invokes `paint`, so it can
    // never tell a working slip from an empty one.
    expect(painterState.calls.length).toBeGreaterThan(0);
    const calledMethods = new Set(painterState.calls.map((c) => c.method));
    expect(calledMethods.has("text")).toBe(true);
    // The QR code modules themselves are drawn as rects.
    expect(calledMethods.has("rect")).toBe(true);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("notifies the user and restores isSpaceSufficient when a draw call throws", () => {
    const originalIsSpaceSufficient = SwissQRBill.isSpaceSufficient;
    // `save` is only reached partway through SwissQRBill's render (after the
    // outline, the receipt-side labels, and the payment-part header have
    // already been drawn), so this proves the failure happens mid-render,
    // not on the very first call.
    painterState.failOn = "save";

    render(<QRBillCanvas data={validData} language="EN" />);

    expect(painterState.calls.length).toBeGreaterThan(0);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "The QR payment slip could not be generated for this invoice."
    );

    // Pins defect 2: a failed attachTo must not leave the process-wide
    // static patched for every later render in the session (e.g. the
    // trustee export, which renders many invoices in a loop).
    expect(SwissQRBill.isSpaceSufficient).toBe(originalIsSpaceSufficient);
  });
});
