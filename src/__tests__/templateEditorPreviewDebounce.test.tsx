import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

// The template editor's live preview redraws the whole invoice PDF, so it
// must follow the form after a pause, not on every keystroke (P10).

const previewNames: string[] = [];

vi.mock("@react-pdf/renderer", () => ({
  PDFViewer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/invoice/InvoicePDF", () => ({
  InvoicePDF: ({ template }: { template: { name: string } }) => {
    previewNames.push(template.name);
    return null;
  },
}));
vi.mock("../db/hooks/useInvoiceTemplates", () => {
  const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    useCreateInvoiceTemplate: () => mutation,
    useUpdateInvoiceTemplate: () => mutation,
    useSetDefaultTemplate: () => mutation,
  };
});

import { TemplateEditor, PREVIEW_DEBOUNCE_MS } from "../components/invoice/TemplateEditor";

afterEach(() => {
  cleanup();
  previewNames.length = 0;
  vi.useRealTimers();
});

describe("TemplateEditor live preview", () => {
  it("redraws the PDF once, 300 ms after the last keystroke", () => {
    vi.useFakeTimers();
    render(<TemplateEditor template={null} onSaved={() => {}} />);
    const input = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    const before = previewNames[previewNames.length - 1];

    for (const value of ["A", "Ac", "Acm", "Acme"]) {
      fireEvent.change(input, { target: { value } });
      act(() => vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 50));
    }
    // Still typing: the preview hasn't picked up any of it.
    expect(previewNames[previewNames.length - 1]).toBe(before);
    expect(previewNames).not.toContain("A");

    act(() => vi.advanceTimersByTime(50));
    expect(previewNames[previewNames.length - 1]).toBe("Acme");
    expect(previewNames.filter((n) => n.startsWith("A") && n !== "Acme")).toEqual([]);
  });

  it("settles: no further redraws once the form is idle", async () => {
    render(<TemplateEditor template={null} onSaved={() => {}} />);
    const input = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Studio" } });
    await waitFor(() => expect(previewNames[previewNames.length - 1]).toBe("Studio"));
    const count = previewNames.length;
    await new Promise((r) => setTimeout(r, PREVIEW_DEBOUNCE_MS * 2));
    expect(previewNames.length).toBe(count);
  });
});
