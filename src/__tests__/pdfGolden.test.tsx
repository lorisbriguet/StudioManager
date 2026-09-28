/**
 * Golden record of the invoice and quote PDF element trees.
 *
 * react-pdf renders these components straight to PDF bytes, so a refactor that
 * "looks equivalent" can still move text on a real invoice. These snapshots are
 * taken while the components are still untouched; any later change to them must
 * leave the snapshots byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

vi.mock("@react-pdf/renderer", async () => {
  const { createElement } = await import("react");
  // The shape react-pdf passes when it calls a <Text render={...}> callback
  // while paginating a real PDF; fixed so the page-number text is stable.
  const PAGE_NUMBER_CONTEXT = { pageNumber: 1, totalPages: 2 };
  // JSON.stringify silently drops function-valued props (e.g. the
  // page-number `render` callback and the QR bill's `paint` callback),
  // which used to make them vanish from the snapshot without a trace.
  // Serialise every function as a named marker instead of dropping it.
  const serializeProps = (rest: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        typeof value === "function" ? `[Function ${key}]` : value,
      ])
    );
  const el =
    (tag: string) =>
    ({ children, style, ...rest }: Record<string, unknown> & { children?: unknown; style?: unknown }) => {
      // The page-number Text elements pass no children, only a `render`
      // callback — invoke it with a fixed context so its actual output
      // (the "Page 1 / 2" text) is captured, not just the callback's marker.
      const renderProp = rest.render;
      const rendered =
        typeof renderProp === "function"
          ? (renderProp as (ctx: typeof PAGE_NUMBER_CONTEXT) => unknown)(PAGE_NUMBER_CONTEXT)
          : children;
      return createElement(
        "div",
        {
          "data-pdf": tag,
          "data-style": JSON.stringify(style ?? null),
          "data-props": JSON.stringify(serializeProps(rest)),
        },
        rendered as never
      );
    };
  return {
    Document: el("Document"),
    Page: el("Page"),
    View: el("View"),
    Text: el("Text"),
    Image: el("Image"),
    Svg: el("Svg"),
    G: el("G"),
    Path: el("Path"),
    Rect: el("Rect"),
    Line: el("Line"),
    Polygon: el("Polygon"),
    // InvoicePDF's QR bill goes through QRBillSvgRenderer, which draws via
    // <Canvas paint={...}>. Not in the brief's mock list — without it, react
    // fails to resolve the element type (undefined) and the QR-bill render
    // throws. Added here so the QR-bill branch can actually be exercised.
    // Note: `paint` is only serialized as the "[Function paint]" marker
    // above — it is never invoked here, so the QR bill's actual drawing
    // logic is NOT covered by these snapshots, only its container (the
    // fixed-height View) and the presence of the Canvas + paint prop.
    Canvas: el("Canvas"),
    StyleSheet: { create: (o: unknown) => o },
    Font: { register: () => {}, registerHyphenationCallback: () => {} },
  };
});

import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { QuotePDF } from "../components/quote/QuotePDF";
import { useAppStore } from "../stores/app-store";
import {
  invoiceFixture,
  quoteFixture,
  clientFixture,
  profileFixture,
  templateFixture,
  lineItemsFixture,
  uniformLineItemsFixture,
  hiddenTemplateFixture,
  billingAddressFixture,
  contactNameFixture,
  vatExemptProfileFixture,
  enDraftQuoteFixture,
} from "./fixtures/pdfFixtures";

// formatDisplayDate reads the date format from the app store rather than a
// prop. Pin it explicitly so the snapshot text never depends on stored
// preferences leaking in from another test file.
beforeEach(() => {
  useAppStore.setState({ dateFormat: "dd.MM.yyyy" });
});

afterEach(cleanup);

describe("invoice PDF golden", () => {
  it("renders the standard invoice unchanged", () => {
    const { container } = render(
      <InvoicePDF invoice={invoiceFixture} lineItems={lineItemsFixture} client={clientFixture} profile={profileFixture} template={templateFixture} projectName="Brand refresh" />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders a reminder invoice unchanged", () => {
    const { container } = render(
      <InvoicePDF invoice={invoiceFixture} lineItems={lineItemsFixture} client={clientFixture} profile={profileFixture} template={templateFixture} reminderCount={2} />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the collapsed global-rate table unchanged", () => {
    const { container } = render(
      <InvoicePDF invoice={invoiceFixture} lineItems={uniformLineItemsFixture} client={clientFixture} profile={profileFixture} template={templateFixture} />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders with a billing address override and contact name", () => {
    const { container } = render(
      <InvoicePDF
        invoice={invoiceFixture}
        lineItems={lineItemsFixture}
        client={clientFixture}
        profile={profileFixture}
        template={templateFixture}
        contactName={contactNameFixture}
        billingAddress={billingAddressFixture}
      />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders with all show_* template flags hidden (no QR bill)", () => {
    // hiddenTemplateFixture has show_qr_bill: 0, which is also the no-QR-bill
    // case: shouldRenderQrBill(invoice, profile, showQrBill) is false because
    // showQrBill is false, even though invoice.currency and profile.iban both
    // still satisfy the other two conditions.
    const { container } = render(
      <InvoicePDF invoice={invoiceFixture} lineItems={lineItemsFixture} client={clientFixture} profile={profileFixture} template={hiddenTemplateFixture} projectName="Brand refresh" />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders with no template supplied (defaults)", () => {
    const { container } = render(
      <InvoicePDF invoice={invoiceFixture} lineItems={lineItemsFixture} client={clientFixture} profile={profileFixture} />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe("quote PDF golden", () => {
  it("renders the standard quote unchanged", () => {
    const { container } = render(
      <QuotePDF quote={quoteFixture} lineItems={lineItemsFixture} client={clientFixture} profile={profileFixture} template={templateFixture} projectName="Brand refresh" />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders with a billing address override and contact name", () => {
    const { container } = render(
      <QuotePDF
        quote={quoteFixture}
        lineItems={lineItemsFixture}
        client={clientFixture}
        profile={profileFixture}
        template={templateFixture}
        contactName={contactNameFixture}
        billingAddress={billingAddressFixture}
      />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders with all show_* template flags hidden", () => {
    const { container } = render(
      <QuotePDF quote={quoteFixture} lineItems={lineItemsFixture} client={clientFixture} profile={profileFixture} template={hiddenTemplateFixture} projectName="Brand refresh" />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders an EN draft quote with VAT exemption", () => {
    const { container } = render(
      <QuotePDF quote={enDraftQuoteFixture} lineItems={lineItemsFixture} client={clientFixture} profile={vatExemptProfileFixture} template={templateFixture} />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});
