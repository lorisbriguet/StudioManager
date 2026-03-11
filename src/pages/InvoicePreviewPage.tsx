import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { readFile } from "@tauri-apps/plugin-fs";
import { useInvoice, useInvoiceLineItems } from "../db/hooks/useInvoices";
import { useClient } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { toast } from "sonner";
import { useT } from "../i18n/useT";

export function InvoicePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const navigate = useNavigate();

  const { data: invoice, isLoading: loadingInvoice } = useInvoice(invoiceId);
  const { data: lineItems, isLoading: loadingItems } = useInvoiceLineItems(invoiceId);
  const { data: client } = useClient(invoice?.client_id ?? "");
  const { data: profile } = useBusinessProfile();
  const [storedPdfUrl, setStoredPdfUrl] = useState<string | null>(null);
  const t = useT();

  const isLoading = loadingInvoice || loadingItems;

  // Load stored PDF if available
  useEffect(() => {
    if (!invoice?.pdf_path) return;
    let url: string | null = null;
    readFile(invoice.pdf_path)
      .then((bytes) => {
        const blob = new Blob([bytes], { type: "application/pdf" });
        url = URL.createObjectURL(blob);
        setStoredPdfUrl(url);
      })
      .catch(() => setStoredPdfUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [invoice?.pdf_path]);

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;
  if (!invoice || !lineItems || !client || !profile)
    return <div className="text-muted text-sm">{t.invoice_not_found}</div>;

  const pdfDocument = (
    <InvoicePDF
      invoice={invoice}
      lineItems={lineItems}
      client={client}
      profile={profile}
    />
  );

  const downloadPdf = async () => {
    try {
      if (storedPdfUrl) {
        const a = document.createElement("a");
        a.href = storedPdfUrl;
        a.download = `${invoice.reference}.pdf`;
        a.click();
        toast.success("PDF downloaded");
        return;
      }
      const blob = await pdf(pdfDocument).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.reference}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch {
      toast.error("Failed to generate PDF");
    }
  };

  return (
    <div className="flex flex-col -m-8 h-screen">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white dark:bg-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-gray-900"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold flex-1">
          {invoice.reference} — {client.name}
        </h1>
        <button
          onClick={downloadPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          <Download size={14} /> {t.download_pdf}
        </button>
      </div>
      <div className="flex-1 bg-gray-100">
        {storedPdfUrl ? (
          <iframe
            src={storedPdfUrl}
            title={invoice.reference}
            className="w-full h-full border-0"
          />
        ) : (
          <PDFViewer
            width="100%"
            height="100%"
            showToolbar={false}
            style={{ border: "none" }}
          >
            {pdfDocument}
          </PDFViewer>
        )}
      </div>
    </div>
  );
}
