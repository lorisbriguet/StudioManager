import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { useQuote } from "../db/hooks/useQuotes";
import { useQuoteLineItems } from "../db/hooks/useQuoteLineItems";
import { useClient } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { QuotePDF } from "../components/quote/QuotePDF";
import { toast } from "sonner";
import { useT } from "../i18n/useT";

export function QuotePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const quoteId = Number(id);
  const navigate = useNavigate();

  const { data: quote, isLoading: loadingQuote } = useQuote(quoteId);
  const { data: lineItems, isLoading: loadingItems } = useQuoteLineItems(quoteId);
  const { data: client } = useClient(quote?.client_id ?? "");
  const { data: profile } = useBusinessProfile();
  const t = useT();

  const isLoading = loadingQuote || loadingItems;

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;
  if (!quote || !lineItems || !client || !profile)
    return <div className="text-muted text-sm">{t.quote_not_found}</div>;

  const pdfDocument = (
    <QuotePDF
      quote={quote}
      lineItems={lineItems}
      client={client}
      profile={profile}
    />
  );

  const downloadPdf = async () => {
    try {
      const blob = await pdf(pdfDocument).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.reference}_${client.name}.pdf`;
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
          {quote.reference} — {client.name}
        </h1>
        <button
          onClick={downloadPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          <Download size={14} /> {t.download_pdf}
        </button>
      </div>
      <div className="flex-1 bg-gray-100">
        <PDFViewer
          width="100%"
          height="100%"
          showToolbar={false}
          style={{ border: "none" }}
        >
          {pdfDocument}
        </PDFViewer>
      </div>
    </div>
  );
}
