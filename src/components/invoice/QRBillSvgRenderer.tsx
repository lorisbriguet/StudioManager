import { Canvas } from "@react-pdf/renderer";
import { SwissQRBill } from "swissqrbill/pdf";
import type { Data } from "swissqrbill/types";
import { logError } from "../../lib/log";

interface QRBillCanvasProps {
  data: Data;
  language: "DE" | "FR" | "IT" | "EN";
}

/**
 * Create a wrapper object that acts like a PDFKit document.
 * Delegates drawing calls to the real painter, provides missing text-flow methods.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createDocWrapper(painter: any) {
  let currentFontSize = 10;
  let cursorY = 0;

  const wrapper: Record<string, unknown> = {
    // Page info
    page: { width: SwissQRBill.width, height: SwissQRBill.height },

    // Cursor Y position
    get y() { return cursorY; },
    set y(v: number) { cursorY = v; },

    // No-ops for doc-level methods
    addPage: () => wrapper,
    addContent: () => wrapper,

    // Font size tracking
    fontSize: (size: number) => {
      currentFontSize = size;
      if (painter.fontSize) painter.fontSize(size);
      return wrapper;
    },

    // Font
    font: (name: string) => {
      if (painter.font) painter.font(name);
      return wrapper;
    },

    // Text with y tracking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    text: (content: string, ...args: any[]) => {
      if (painter.text) painter.text(content, ...args);
      // Update cursor Y after text
      if (typeof content === "string") {
        const lines = content.split("\n").length;
        cursorY += lines * currentFontSize * 1.15;
      }
      return wrapper;
    },

    // Move cursor down
    moveDown: (lines = 1) => {
      cursorY += lines * currentFontSize * 1.15;
      return wrapper;
    },

    // Estimate text height
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    heightOfString: (text: string, options?: any) => {
      const width = options?.width || SwissQRBill.width;
      const charsPerLine = Math.floor(width / (currentFontSize * 0.5));
      const textLines = text.split("\n");
      let totalLines = 0;
      for (const line of textLines) {
        totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
      }
      return totalLines * currentFontSize * 1.15;
    },

    // Drawing methods — delegate to painter, return wrapper for chaining
    moveTo: (...args: unknown[]) => { painter.moveTo(...args); return wrapper; },
    lineTo: (...args: unknown[]) => { painter.lineTo(...args); return wrapper; },
    lineWidth: (...args: unknown[]) => { painter.lineWidth(...args); return wrapper; },
    strokeOpacity: (...args: unknown[]) => { painter.strokeOpacity?.(...args); return wrapper; },
    dash: (...args: unknown[]) => { painter.dash?.(...args); return wrapper; },
    undash: () => { painter.undash?.(); return wrapper; },
    strokeColor: (...args: unknown[]) => { painter.strokeColor?.(...args); return wrapper; },
    fillColor: (...args: unknown[]) => { painter.fillColor?.(...args); return wrapper; },
    stroke: (...args: unknown[]) => { painter.stroke?.(...args); return wrapper; },
    fill: (...args: unknown[]) => { painter.fill?.(...args); return wrapper; },
    rect: (...args: unknown[]) => { painter.rect?.(...args); return wrapper; },
    save: () => { painter.save?.(); return wrapper; },
    restore: () => { painter.restore?.(); return wrapper; },
    translate: (...args: unknown[]) => { painter.translate?.(...args); return wrapper; },
    scale: (...args: unknown[]) => { painter.scale?.(...args); return wrapper; },
    path: (...args: unknown[]) => { painter.path?.(...args); return wrapper; },
    fillAndStroke: (...args: unknown[]) => { painter.fillAndStroke?.(...args); return wrapper; },
    circle: (...args: unknown[]) => { painter.circle?.(...args); return wrapper; },
    clip: () => { painter.clip?.(); return wrapper; },
    image: (...args: unknown[]) => { painter.image?.(...args); return wrapper; },
  };

  return wrapper;
}

export function QRBillCanvas({ data, language }: QRBillCanvasProps) {
  return (
    <Canvas
      paint={(painter, _availableWidth, _availableHeight) => {
        try {
          const qrBill = new SwissQRBill(data, {
            language,
            scissors: false,
            outlines: true,
          });

          // Override space check to prevent addPage call
          const origCheck = SwissQRBill.isSpaceSufficient;
          SwissQRBill.isSpaceSufficient = () => true;

          const doc = createDocWrapper(painter);
          qrBill.attachTo(doc as never, 0, 0);

          SwissQRBill.isSpaceSufficient = origCheck;
        } catch (e) {
          logError("QR bill render failed:", e);
        }
        return null;
      }}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
