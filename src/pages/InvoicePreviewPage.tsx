import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, FileText } from "lucide-react";
import { Button, PageHeader, EmptyState, QueryError, DetailSkeleton } from "../components/ui";
import { confirmDraftExport } from "../lib/confirmDraftExport";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { readFile } from "@tauri-apps/plugin-fs";
import { useInvoice, useInvoiceLineItems, useUpdateInvoice } from "../db/hooks/useInvoices";
import { getInvoice } from "../db/queries/invoices";
import { pdfFileName } from "../lib/pdfFilename";
import type { Invoice } from "../types/invoice";
import { useClient, useClientContacts, useClientAddresses } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { useProject } from "../db/hooks/useProjects";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { useInvoiceTemplate } from "../db/hooks/useInvoiceTemplates";
import { postProcessInvoicePdf } from "../lib/pdfPostProcess";
import { notify } from "../lib/notify";
import { useT } from "../i18n/useT";

export function InvoicePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const navigate = useNavigate();

  const invoiceQuery = useInvoice(invoiceId);
  const { data: invoice } = invoiceQuery;
  const { data: lineItems } = useInvoiceLineItems(invoiceId);
  const { data: client } = useClient(invoice?.client_id ?? "");
  const { data: contacts } = useClientContacts(invoice?.client_id ?? "");
  const { data: addresses } = useClientAddresses(invoice?.client_id ?? "");
  const { data: profile } = useBusinessProfile();
  const { data: project } = useProject(invoice?.project_id ?? 0);
  const invoiceTemplateId = invoice && "template_id" in invoice
    ? (invoice as { template_id?: number | null }).template_id ?? null
    : null;
  const { data: invoiceTemplate } = useInvoiceTemplate(invoiceTemplateId);
  const selectedContact = invoice?.contact_id
    ? contacts?.find((c) => c.id === invoice.contact_id)
    : null;
  const contactName = selectedContact
    ? `${selectedContact.first_name} ${selectedContact.last_name}`.trim()
    : undefined;
  const [storedPdfUrl, setStoredPdfUrl] = useState<string | null>(null);
  const [postProcessedUrl, setPostProcessedUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const updateInvoice = useUpdateInvoice();
  const t = useT();

  // Loading until the invoice and everything the PDF needs is in: "not found" must not flash while the client loads.
  const isLoading = !!invoiceId && (invoice === undefined || (!!invoice && (lineItems === undefined || (!!invoice.client_id && client === undefined) || profile === undefined)));
  const needsPostProcess = invoice?.status === "cancelled";

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
      .catch(() => {
        if (url) URL.revokeObjectURL(url);
        setStoredPdfUrl(null);
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [invoice?.pdf_path]);

  // Generate post-processed preview for cancelled/TBD invoices
  useEffect(() => {
    if (!invoice || !lineItems || !client || !profile || !needsPostProcess) return;
    let url: string | null = null;
    (async () => {
      const doc = (
        <InvoicePDF
          invoice={invoice}
          lineItems={lineItems}
          client={client}
          profile={profile}
          contactName={contactName}
          billingAddress={invoice.billing_address_id
            ? addresses?.find((a) => a.id === invoice.billing_address_id) ?? null
            : null}
          projectName={project?.name}
          reminderCount={invoice.reminder_count}
          template={invoiceTemplate ?? undefined}
        />
      );
      const blob = await pdf(doc).toBlob();
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      const processed = await postProcessInvoicePdf(rawBytes, {
        isCancelled: invoice.status === "cancelled",
      });
      const processedBlob = new Blob([new Uint8Array(processed)], { type: "application/pdf" });
      url = URL.createObjectURL(processedBlob);
      setPostProcessedUrl(url);
    })().catch(() => {
      if (url) URL.revokeObjectURL(url);
      setPostProcessedUrl(null);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [invoice, lineItems, client, profile, contactName, addresses, project, needsPostProcess, invoiceTemplate]);

  if (invoiceQuery.isError && invoice === undefined)
    return <QueryError message={t.load_error_invoice} onRetry={invoiceQuery.refetch} retrying={invoiceQuery.isFetching} />;
  if (isLoading) return <DetailSkeleton />;
  if (!invoice || !lineItems || !client || !profile)
    return (
      <EmptyState
        icon={FileText}
        message={t.invoice_not_found}
        hint={t.not_found_hint}
        action={<Button variant="secondary" onClick={() => navigate("/invoices")}>{t.back_to_invoices}</Button>}
      />
    );

  const buildPdfDoc = (inv: Invoice) => (
    <InvoicePDF
      invoice={inv}
      lineItems={lineItems}
      client={client}
      profile={profile}
      contactName={contactName}
      billingAddress={inv.billing_address_id
        ? addresses?.find((a) => a.id === inv.billing_address_id) ?? null
        : null}
      projectName={project?.name}
      reminderCount={inv.reminder_count}
      template={invoiceTemplate ?? undefined}
    />
  );

  const pdfDocument = buildPdfDoc(invoice);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // `inv` defaults to the invoice from the query cache; callers that just
  // mutated the invoice must pass a freshly fetched row, because the closure
  // copy is stale until the refetch lands (the draft-name export bug).
  const doDownload = async (inv: Invoice = invoice) => {
    if (exporting) return;
    setExporting(true);
    try {
      const filename = pdfFileName(inv.reference, client.name);
      if (inv.pdf_path) {
        try {
          const bytes = await readFile(inv.pdf_path);
          triggerDownload(new Blob([bytes], { type: "application/pdf" }), filename);
          notify.success(t.pdf_downloaded);
          return;
        } catch {
          // stored file unreadable — fall through to client-side render
        }
      }
      const blob = await pdf(buildPdfDoc(inv)).toBlob();
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      const processed = await postProcessInvoicePdf(rawBytes, {
        isCancelled: inv.status === "cancelled",
      });
      triggerDownload(new Blob([new Uint8Array(processed)], { type: "application/pdf" }), filename);
      notify.success(t.pdf_downloaded);
    } catch (e) {
      notify.error(t.failed_to_generate_pdf, e);
    } finally {
      setExporting(false);
    }
  };

  const downloadPdf = async () => {
    if (invoice.status !== "draft") return doDownload();
    const choice = await confirmDraftExport();
    if (choice === "draft") await doDownload();
    if (choice === "sent") handleMarkSentAndExport();
  };

  const handleMarkSentAndExport = () => {
    updateInvoice.mutate(
      { id: invoiceId, data: { status: "sent" } },
      {
        onSuccess: async () => {
          const fresh = await getInvoice(invoiceId);
          await doDownload(fresh ?? invoice);
        },
      }
    );
  };

  return (
    <div className="flex flex-col -m-8 h-screen">
      <PageHeader
        compact
        title={`${invoice.reference} — ${client.name}`}
        back={() => navigate(-1)}
        actions={
          <Button icon={<Download size={12} />} loading={exporting || updateInvoice.isPending} onClick={downloadPdf}>
            {t.download_pdf}
          </Button>
        }
      />
      <div className="flex-1 bg-[var(--color-bg)]">
        {storedPdfUrl ? (
          <iframe
            src={storedPdfUrl}
            title={invoice.reference}
            className="w-full h-full border-0"
          />
        ) : postProcessedUrl ? (
          <iframe
            src={postProcessedUrl}
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
