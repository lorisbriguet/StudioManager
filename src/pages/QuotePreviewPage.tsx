import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FolderPlus } from "lucide-react";
import { Button, PageSpinner, Modal } from "../components/ui";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { useQuote, useUpdateQuote } from "../db/hooks/useQuotes";
import { getQuote } from "../db/queries/quotes";
import { pdfFileName } from "../lib/pdfFilename";
import type { Quote } from "../types/quote";
import { useQuoteLineItems } from "../db/hooks/useQuoteLineItems";
import { useClient, useClientAddresses } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { useProject } from "../db/hooks/useProjects";
import { QuotePDF } from "../components/quote/QuotePDF";
import { useInvoiceTemplate } from "../db/hooks/useInvoiceTemplates";
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
  const quoteTemplateId = quote && "template_id" in quote
    ? (quote as { template_id?: number | null }).template_id ?? null
    : null;
  const { data: quoteTemplate } = useInvoiceTemplate(quoteTemplateId);
  const [showDraftWarning, setShowDraftWarning] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [exporting, setExporting] = useState(false);
  const updateQuote = useUpdateQuote();
  const t = useT();

  const isLoading = loadingQuote || loadingItems;

  if (isLoading) return <PageSpinner />;
  if (!quote || !lineItems || !client || !profile)
    return <div className="text-muted text-sm">{t.quote_not_found}</div>;

  const billingAddress = quote.billing_address_id
    ? addresses?.find((a) => a.id === quote.billing_address_id) ?? null
    : null;

  const buildPdfDoc = (qt: Quote) => (
    <QuotePDF
      quote={qt}
      lineItems={lineItems}
      client={client}
      profile={profile}
      billingAddress={billingAddress}
      projectName={project?.name}
      template={quoteTemplate ?? undefined}
    />
  );

  const pdfDocument = buildPdfDoc(quote);

  // `qt` defaults to the quote from the query cache; callers that just
  // mutated the quote must pass a freshly fetched row — the closure copy is
  // stale until the refetch lands (same draft-name bug as invoice export).
  const doDownload = async (qt: Quote = quote) => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await pdf(buildPdfDoc(qt)).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pdfFileName(
        qt.reference.startsWith("DRAFT") ? "DRAFT" : qt.reference,
        client.name
      );
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t.pdf_downloaded);
    } catch {
      toast.error(t.failed_to_generate_pdf);
    } finally {
      setExporting(false);
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
      {
        onSuccess: async () => {
          setShowDraftWarning(false);
          const fresh = await getQuote(quoteId);
          await doDownload(fresh ?? quote);
        },
        onError: (e) => {
          setShowDraftWarning(false);
          toast.error(String(e));
        },
      }
    );
  };

  return (
    <div className="flex flex-col -m-8 h-screen">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border-divider)] bg-[var(--color-surface)]">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-[var(--color-text)]"
          aria-label={t.back}
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
        <Button icon={<Download size={14} />} loading={exporting} onClick={downloadPdf}>
          {t.download_pdf}
        </Button>
      </div>
      <div className="flex-1 bg-[var(--color-bg)]">
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
      <Modal
        open={showDraftWarning}
        onClose={() => setShowDraftWarning(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowDraftWarning(false)}>
              {t.cancel}
            </Button>
            <Button variant="secondary" onClick={() => { setShowDraftWarning(false); doDownload(); }}>
              {t.export_as_draft}
            </Button>
            <Button loading={updateQuote.isPending} onClick={handleMarkSentAndExport}>
              {t.mark_sent_and_export}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t.export_draft_warning}</p>
      </Modal>
    </div>
  );
}
