import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FolderPlus } from "lucide-react";
import { Button } from "../components/ui";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { useQuote, useUpdateQuote } from "../db/hooks/useQuotes";
import { useQuoteLineItems } from "../db/hooks/useQuoteLineItems";
import { useClient, useClientAddresses } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { useProject } from "../db/hooks/useProjects";
import { QuotePDF } from "../components/quote/QuotePDF";
import { QuoteToProjectWizard } from "../components/QuoteToProjectWizard";
import { toast } from "sonner";
import { useT } from "../i18n/useT";

export function QuotePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const quoteId = Number(id);
  const navigate = useNavigate();

  const { data: quote, isLoading: loadingQuote } = useQuote(quoteId);
  const { data: lineItems, isLoading: loadingItems } = useQuoteLineItems(quoteId);
  const { data: client } = useClient(quote?.client_id ?? "");
  const { data: addresses } = useClientAddresses(quote?.client_id ?? "");
  const { data: profile } = useBusinessProfile();
  const { data: project } = useProject(quote?.project_id ?? 0);
  const [showDraftWarning, setShowDraftWarning] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const updateQuote = useUpdateQuote();
  const t = useT();

  const isLoading = loadingQuote || loadingItems;

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;
  if (!quote || !lineItems || !client || !profile)
    return <div className="text-muted text-sm">{t.quote_not_found}</div>;

  const billingAddress = quote.billing_address_id
    ? addresses?.find((a) => a.id === quote.billing_address_id) ?? null
    : null;

  const pdfDocument = (
    <QuotePDF
      quote={quote}
      lineItems={lineItems}
      client={client}
      profile={profile}
      billingAddress={billingAddress}
      projectName={project?.name}
    />
  );

  const doDownload = async () => {
    try {
      const blob = await pdf(pdfDocument).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.reference.startsWith("DRAFT") ? "DRAFT" : quote.reference}_${client.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch {
      toast.error("Failed to generate PDF");
    }
  };

  const downloadPdf = () => {
    if (quote.status === "draft") {
      setShowDraftWarning(true);
    } else {
      doDownload();
    }
  };

  const handleMarkSentAndExport = () => {
    updateQuote.mutate(
      { id: quoteId, data: { status: "sent" } },
      { onSuccess: () => { setShowDraftWarning(false); doDownload(); } }
    );
  };

  return (
    <div className="flex flex-col -m-8 h-screen">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white dark:bg-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-gray-900 dark:hover:text-gray-200"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold flex-1">
          {quote.reference.startsWith("DRAFT") ? t.draft : quote.reference} — {client.name}
        </h1>
        {quote.status === "accepted" && !quote.converted_to_project_id && (
          <Button variant="secondary" icon={<FolderPlus size={14} />} onClick={() => setShowWizard(true)}>
            {t.generate_project}
          </Button>
        )}
        <Button icon={<Download size={14} />} onClick={downloadPdf}>
          {t.download_pdf}
        </Button>
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
      {showWizard && lineItems && (
        <QuoteToProjectWizard
          open={showWizard}
          onClose={() => setShowWizard(false)}
          quote={quote}
          lineItems={lineItems}
          clientName={client.name}
        />
      )}
      {showDraftWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-100 rounded-xl shadow-xl p-6 max-w-sm mx-4">
            <p className="text-sm mb-4">{t.export_draft_warning}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowDraftWarning(false)}>
                {t.cancel}
              </Button>
              <Button variant="secondary" onClick={() => { setShowDraftWarning(false); doDownload(); }}>
                {t.export_as_draft}
              </Button>
              <Button onClick={handleMarkSentAndExport}>
                {t.mark_sent_and_export}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
