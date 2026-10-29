import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, FileText, FolderPlus } from "lucide-react";
import { Button, PageHeader, EmptyState, QueryError, DetailSkeleton } from "../components/ui";
import { confirmDraftExport } from "../lib/confirmDraftExport";
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
import { notify } from "../lib/notify";
import { useT } from "../i18n/useT";

export function QuotePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const quoteId = Number(id);
  const navigate = useNavigate();

  const quoteQuery = useQuote(quoteId);
  const { data: quote } = quoteQuery;
  const { data: lineItems } = useQuoteLineItems(quoteId);
  const { data: client } = useClient(quote?.client_id ?? "");
  const { data: addresses } = useClientAddresses(quote?.client_id ?? "");
  const { data: profile } = useBusinessProfile();
  const { data: project } = useProject(quote?.project_id ?? 0);
  const quoteTemplateId = quote && "template_id" in quote
    ? (quote as { template_id?: number | null }).template_id ?? null
    : null;
  const { data: quoteTemplate } = useInvoiceTemplate(quoteTemplateId);
  const [showWizard, setShowWizard] = useState(false);
  const [exporting, setExporting] = useState(false);
  const updateQuote = useUpdateQuote();
  const t = useT();

  // Loading until the quote and everything the PDF needs is in: "not found" must not flash while the client loads.
  const isLoading = !!quoteId && (quote === undefined || (!!quote && (lineItems === undefined || (!!quote.client_id && client === undefined) || profile === undefined)));

  if (quoteQuery.isError && quote === undefined)
    return <QueryError message={t.load_error_quote} onRetry={quoteQuery.refetch} retrying={quoteQuery.isFetching} />;
  if (isLoading) return <DetailSkeleton />;
  if (!quote || !lineItems || !client || !profile)
    return (
      <EmptyState
        icon={FileText}
        message={t.quote_not_found}
        hint={t.not_found_hint}
        action={<Button variant="secondary" onClick={() => navigate("/quotes")}>{t.back_to_quotes}</Button>}
      />
    );

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
      notify.success(t.pdf_downloaded);
    } catch (e) {
      notify.error(t.failed_to_generate_pdf, e);
    } finally {
      setExporting(false);
    }
  };

  const downloadPdf = async () => {
    if (quote.status !== "draft") return doDownload();
    const choice = await confirmDraftExport();
    if (choice === "draft") await doDownload();
    if (choice === "sent") handleMarkSentAndExport();
  };

  const handleMarkSentAndExport = () => {
    updateQuote.mutate(
      { id: quoteId, data: { status: "sent" } },
      {
        onSuccess: async () => {
          const fresh = await getQuote(quoteId);
          await doDownload(fresh ?? quote);
        },
      }
    );
  };

  return (
    <div className="flex flex-col -m-8 h-screen">
      <PageHeader
        compact
        title={`${quote.reference.startsWith("DRAFT") ? t.draft : quote.reference} — ${client.name}`}
        back={() => navigate(-1)}
        actions={<>
          {quote.status === "accepted" && !quote.converted_to_project_id && (
            <Button variant="secondary" icon={<FolderPlus size={12} />} onClick={() => setShowWizard(true)}>
              {t.generate_project}
            </Button>
          )}
          <Button icon={<Download size={12} />} loading={exporting || updateQuote.isPending} onClick={downloadPdf}>
            {t.download_pdf}
          </Button>
        </>}
      />
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
    </div>
  );
}
