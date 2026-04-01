import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { Button, PageSpinner } from "../components/ui";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { readFile } from "@tauri-apps/plugin-fs";
import { useInvoice, useInvoiceLineItems, useUpdateInvoice } from "../db/hooks/useInvoices";
import { useClient, useClientContacts, useClientAddresses } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { useProject } from "../db/hooks/useProjects";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { postProcessInvoicePdf } from "../lib/pdfPostProcess";
import { toast } from "sonner";
import { useT } from "../i18n/useT";

export function InvoicePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const navigate = useNavigate();

  const { data: invoice, isLoading: loadingInvoice } = useInvoice(invoiceId);
  const { data: lineItems, isLoading: loadingItems } = useInvoiceLineItems(invoiceId);
  const { data: client } = useClient(invoice?.client_id ?? "");
  const { data: contacts } = useClientContacts(invoice?.client_id ?? "");
  const { data: addresses } = useClientAddresses(invoice?.client_id ?? "");
  const { data: profile } = useBusinessProfile();
  const { data: project } = useProject(invoice?.project_id ?? 0);
  const selectedContact = invoice?.contact_id
    ? contacts?.find((c) => c.id === invoice.contact_id)
    : null;
  const contactName = selectedContact
    ? `${selectedContact.first_name} ${selectedContact.last_name}`.trim()
    : undefined;
  const [storedPdfUrl, setStoredPdfUrl] = useState<string | null>(null);
  const [postProcessedUrl, setPostProcessedUrl] = useState<string | null>(null);
  const [showDraftWarning, setShowDraftWarning] = useState(false);
  const updateInvoice = useUpdateInvoice();
  const t = useT();

  const isLoading = loadingInvoice || loadingItems;
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
  }, [invoice, lineItems, client, profile, contactName, addresses, project, needsPostProcess]);

  if (isLoading) return <PageSpinner />;
  if (!invoice || !lineItems || !client || !profile)
    return <div className="text-muted text-sm">{t.invoice_not_found}</div>;

  const billingAddress = invoice.billing_address_id
    ? addresses?.find((a) => a.id === invoice.billing_address_id) ?? null
    : null;

  const pdfDocument = (
    <InvoicePDF
      invoice={invoice}
      lineItems={lineItems}
      client={client}
      profile={profile}
      contactName={contactName}
      billingAddress={billingAddress}
      projectName={project?.name}
      reminderCount={invoice.reminder_count}
    />
  );

  const doDownload = async () => {
    try {
      if (storedPdfUrl) {
        const a = document.createElement("a");
        a.href = storedPdfUrl;
        a.download = `${invoice.reference}_${client.name}.pdf`;
        a.click();
        toast.success(t.pdf_downloaded);
        return;
      }
      const blob = await pdf(pdfDocument).toBlob();
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      const processed = await postProcessInvoicePdf(rawBytes, {
        isCancelled: invoice.status === "cancelled",
      });
      const processedBlob = new Blob([new Uint8Array(processed)], { type: "application/pdf" });
      const url = URL.createObjectURL(processedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.reference}_${client.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t.pdf_downloaded);
    } catch {
      toast.error(t.failed_to_generate_pdf);
    }
  };

  const downloadPdf = () => {
    if (invoice.status === "draft") {
      setShowDraftWarning(true);
    } else {
      doDownload();
    }
  };

  const handleMarkSentAndExport = () => {
    updateInvoice.mutate(
      { id: invoiceId, data: { status: "sent" } },
      { onSuccess: () => { setShowDraftWarning(false); doDownload(); } }
    );
  };

  return (
    <div className="flex flex-col -m-8 h-screen">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border-divider)] bg-[var(--color-surface)]">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold flex-1">
          {invoice.reference} — {client.name}
        </h1>
        <Button icon={<Download size={14} />} onClick={downloadPdf}>
          {t.download_pdf}
        </Button>
      </div>
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
      {showDraftWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] p-6 max-w-sm mx-4">
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
