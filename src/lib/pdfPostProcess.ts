import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";

/**
 * Add a VOID watermark diagonally across every page.
 * Big red semi-transparent "VOID" text.
 */
export async function addVoidOverlay(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const text = "VOID";
    const fontSize = 120;
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    page.drawText(text, {
      x: width / 2 - textWidth / 2 + 30,
      y: height / 2 - 40,
      size: fontSize,
      font,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.25,
      rotate: degrees(45),
    });
  }

  return new Uint8Array(await doc.save());
}

/**
 * Apply post-processing to a generated PDF based on invoice state.
 * - Cancelled invoices get a VOID overlay
 */
export async function postProcessInvoicePdf(
  pdfBytes: Uint8Array,
  options: {
    isCancelled?: boolean;
  }
): Promise<Uint8Array> {
  let result = pdfBytes;

  if (options.isCancelled) {
    result = await addVoidOverlay(result);
  }

  return result;
}
