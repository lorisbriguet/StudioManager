import { useState, useCallback } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import { ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button, Input } from "../ui";
import { InvoicePDF } from "./InvoicePDF";
import { useT } from "../../i18n/useT";
import {
  useCreateInvoiceTemplate,
  useUpdateInvoiceTemplate,
  useSetDefaultTemplate,
} from "../../db/hooks/useInvoiceTemplates";
import type { InvoiceTemplate } from "../../types/invoice-template";

// ---------------------------------------------------------------------------
// Sample data for live preview
// ---------------------------------------------------------------------------

const sampleInvoice = {
  id: 0,
  reference: "INV-2026-001",
  invoice_date: "2026-01-15",
  due_date: "2026-02-14",
  status: "sent" as const,
  total: 3500,
  subtotal: 3500,
  currency: "CHF",
  notes: "Thank you for your business.",
  activity: "Graphic Design",
  assignment: "Brand Identity",
  po_number: "PO-12345",
  project_id: null,
  client_id: "0",
  language: "en" as const,
  discount_applied: 0,
  discount_rate: 0,
  discount_label: "",
  contact_id: null,
  billing_address_id: null,
  paid_date: null,
  pdf_path: null,
  from_quote_id: null,
  exchange_rate: 1,
  chf_equivalent: 3500,
  reminder_count: 0,
  last_reminder_date: null,
  payment_terms_days: 30,
  template_id: null,
};

const sampleLineItems = [
  {
    id: 1,
    invoice_id: 0,
    designation: "Logo Design",
    quantity: 1,
    rate: 1500,
    unit: "flat rate",
    amount: 1500,
    sort_order: 0,
  },
  {
    id: 2,
    invoice_id: 0,
    designation: "Brand Guidelines",
    quantity: 8,
    rate: 150,
    unit: "hours",
    amount: 1200,
    sort_order: 1,
  },
  {
    id: 3,
    invoice_id: 0,
    designation: "Business Card Design",
    quantity: 1,
    rate: 800,
    unit: "flat rate",
    amount: 800,
    sort_order: 2,
  },
];

const sampleClient = {
  id: "0",
  name: "Acme Corp",
  address: "123 Business St",
  postal_code: "8001",
  city: "Zurich",
  country: "Switzerland",
  email: "hello@acme.ch",
  language: "en" as const,
  phone: "",
  has_discount: 0,
  discount_rate: 0,
  billing_name: "",
};

const sampleProfile = {
  id: 1,
  owner_name: "Loris Briguet",
  address: "Rue de la Paix 1",
  postal_code: "1000",
  city: "Lausanne",
  country: "Switzerland",
  email: "loris@example.ch",
  phone: "+41 79 000 00 00",
  ide_number: "CHE-123.456.789",
  affiliate_number: "",
  bank_name: "UBS Switzerland AG",
  bank_address: "Bahnhofstrasse 45, 8001 Zurich",
  iban: "CH56 0483 5012 3456 7800 9",
  qr_iban: "CH56 0483 5012 3456 7800 9",
  clearing: "8300",
  bic_swift: "UBSWCHZH80A",
  default_activity: '["Graphic Design"]',
  default_payment_terms_days: 30,
  vat_exempt: 1,
  footer_text: "",
};

// ---------------------------------------------------------------------------
// Column order drag/reorder helpers
// ---------------------------------------------------------------------------

type ColumnKey = "designation" | "rate" | "unit" | "qty" | "amount";

const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
  "designation",
  "rate",
  "unit",
  "qty",
  "amount",
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  designation: "Designation",
  rate: "Rate",
  unit: "Unit",
  qty: "Qty",
  amount: "Amount",
};

// ---------------------------------------------------------------------------
// Default template values
// ---------------------------------------------------------------------------

function defaultDraft(): Omit<InvoiceTemplate, "id" | "created_at" | "updated_at"> {
  return {
    name: "New Template",
    is_default: 0,
    accent_color: "#1a1a1a",
    font_family: "Helvetica",
    logo_position: "left",
    margins_top: 35,
    margins_right: 50,
    margins_bottom: 35,
    margins_left: 50,
    show_notes: 1,
    show_project_name: 1,
    show_po_number: 1,
    show_bank_details: 1,
    show_qr_bill: 1,
    show_footer: 1,
    columns: JSON.stringify(DEFAULT_COLUMN_ORDER),
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateEditorProps {
  /** Existing template to edit. If null, create a new one on save. */
  template?: InvoiceTemplate | null;
  onSaved?: (template: InvoiceTemplate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateEditor({ template, onSaved }: TemplateEditorProps) {
  const t = useT();
  const createTemplate = useCreateInvoiceTemplate();
  const updateTemplate = useUpdateInvoiceTemplate();
  const setDefault = useSetDefaultTemplate();

  const initial = template
    ? {
        name: template.name,
        is_default: template.is_default,
        accent_color: template.accent_color ?? "#1a1a1a",
        font_family: (template.font_family ?? "Helvetica") as FontFamily,
        logo_position: (template.logo_position ?? "left") as LogoPosition,
        margins_top: template.margins_top ?? 35,
        margins_right: template.margins_right ?? 50,
        margins_bottom: template.margins_bottom ?? 35,
        margins_left: template.margins_left ?? 50,
        show_notes: template.show_notes ?? 1,
        show_project_name: template.show_project_name ?? 1,
        show_po_number: template.show_po_number ?? 1,
        show_bank_details: template.show_bank_details ?? 1,
        show_qr_bill: template.show_qr_bill ?? 1,
        show_footer: template.show_footer ?? 1,
        columns: parseColumnOrder(template.columns),
      }
    : {
        ...defaultDraft(),
        font_family: "Helvetica" as FontFamily,
        logo_position: "left" as LogoPosition,
        columns: [...DEFAULT_COLUMN_ORDER],
      };

  const [name, setName] = useState(initial.name);
  const [accentColor, setAccentColor] = useState(initial.accent_color);
  const [fontFamily, setFontFamily] = useState<FontFamily>(initial.font_family);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>(initial.logo_position);
  const [marginTop, setMarginTop] = useState(initial.margins_top);
  const [marginRight, setMarginRight] = useState(initial.margins_right);
  const [marginBottom, setMarginBottom] = useState(initial.margins_bottom);
  const [marginLeft, setMarginLeft] = useState(initial.margins_left);
  const [showNotes, setShowNotes] = useState(!!initial.show_notes);
  const [showProjectName, setShowProjectName] = useState(!!initial.show_project_name);
  const [showPoNumber, setShowPoNumber] = useState(!!initial.show_po_number);
  const [showBankDetails, setShowBankDetails] = useState(!!initial.show_bank_details);
  const [showQrBill, setShowQrBill] = useState(!!initial.show_qr_bill);
  const [showFooter, setShowFooter] = useState(!!initial.show_footer);
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(initial.columns);

  // Build current template state for passing to PDF
  const currentTemplateState: Omit<InvoiceTemplate, "id" | "created_at" | "updated_at"> = {
    name,
    is_default: template?.is_default ?? 0,
    accent_color: accentColor,
    font_family: fontFamily,
    logo_position: logoPosition,
    margins_top: marginTop,
    margins_right: marginRight,
    margins_bottom: marginBottom,
    margins_left: marginLeft,
    show_notes: showNotes ? 1 : 0,
    show_project_name: showProjectName ? 1 : 0,
    show_po_number: showPoNumber ? 1 : 0,
    show_bank_details: showBankDetails ? 1 : 0,
    show_qr_bill: showQrBill ? 1 : 0,
    show_footer: showFooter ? 1 : 0,
    columns: JSON.stringify(columnOrder),
  };

  const moveColumn = useCallback((index: number, direction: -1 | 1) => {
    setColumnOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }
    const data = { ...currentTemplateState };

    if (template?.id) {
      updateTemplate.mutate(
        { id: template.id, data },
        {
          onSuccess: () => {
            toast.success(t.template_saved);
            onSaved?.({ ...template, ...data });
          },
          onError: (e) => toast.error(String(e)),
        }
      );
    } else {
      createTemplate.mutate(data, {
        onSuccess: (newId) => {
          toast.success(t.template_saved);
          onSaved?.({ ...data, id: newId, created_at: "", updated_at: "" } as InvoiceTemplate);
        },
        onError: (e) => toast.error(String(e)),
      });
    }
  };

  const handleSetDefault = () => {
    if (!template?.id) return;
    setDefault.mutate(template.id, {
      onSuccess: () => toast.success(t.template_saved),
      onError: (e) => toast.error(String(e)),
    });
  };

  const isPending = createTemplate.isPending || updateTemplate.isPending;

  return (
    <div className="flex gap-0 -m-8" style={{ height: "calc(100vh - 120px)" }}>
      {/* Left panel: settings */}
      <div className="w-[40%] shrink-0 border-r border-[var(--color-border-divider)] overflow-y-auto p-6 space-y-6 bg-[var(--color-surface)]">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t.template_editor}
        </h2>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">{t.name}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Template"
          />
        </div>

        {/* Accent color */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            {t.invoice_template_accent_color}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-[var(--color-border-divider)] bg-[var(--color-input-bg)] p-0.5"
            />
            <Input
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="w-28 font-mono text-xs"
              placeholder="#1a1a1a"
            />
          </div>
        </div>

        {/* Font family */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">{t.font_family}</label>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value as FontFamily)}
            className="w-full border border-[var(--color-border-divider)] rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)]"
          >
            <option value="Helvetica">Helvetica</option>
            <option value="Times-Roman">Times Roman</option>
            <option value="Courier">Courier</option>
          </select>
        </div>

        {/* Logo position */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">{t.logo_position}</label>
          <div className="flex gap-3">
            {(["left", "center", "right", "hide"] as LogoPosition[]).map((pos) => (
              <label key={pos} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="logo_position"
                  value={pos}
                  checked={logoPosition === pos}
                  onChange={() => setLogoPosition(pos)}
                  className="accent-[var(--accent)]"
                />
                <span className="capitalize">{pos}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Margins */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">{t.margins}</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { label: "Top", value: marginTop, set: setMarginTop },
                { label: "Right", value: marginRight, set: setMarginRight },
                { label: "Bottom", value: marginBottom, set: setMarginBottom },
                { label: "Left", value: marginLeft, set: setMarginLeft },
              ] as const
            ).map(({ label, value, set }) => (
              <div key={label}>
                <label className="block text-xs text-muted mb-0.5">{label}</label>
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => set(Number(e.target.value))}
                  className="text-right"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Field visibility toggles */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">Visibility</label>
          <div className="space-y-2">
            {(
              [
                { label: t.show_notes, value: showNotes, set: setShowNotes },
                { label: t.show_project_name, value: showProjectName, set: setShowProjectName },
                { label: t.show_po_number, value: showPoNumber, set: setShowPoNumber },
                { label: t.show_bank_details, value: showBankDetails, set: setShowBankDetails },
                { label: t.show_qr_bill, value: showQrBill, set: setShowQrBill },
                { label: t.show_footer, value: showFooter, set: setShowFooter },
              ] as const
            ).map(({ label, value, set }) => (
              <label
                key={label}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
                  className="accent-[var(--accent)] rounded"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Column order */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">{t.columns}</label>
          <div className="space-y-1">
            {columnOrder.map((col, idx) => (
              <div
                key={col}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border-divider)] bg-[var(--color-bg)] text-sm"
              >
                <span className="flex-1">{COLUMN_LABELS[col]}</span>
                <button
                  type="button"
                  onClick={() => moveColumn(idx, -1)}
                  disabled={idx === 0}
                  className="text-muted hover:text-[var(--color-text)] disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => moveColumn(idx, 1)}
                  disabled={idx === columnOrder.length - 1}
                  className="text-muted hover:text-[var(--color-text)] disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? t.saving : t.save}
          </Button>
          {template?.id && !template.is_default && (
            <Button
              variant="secondary"
              onClick={handleSetDefault}
              disabled={setDefault.isPending}
            >
              {t.set_as_default}
            </Button>
          )}
        </div>
      </div>

      {/* Right panel: live PDF preview */}
      <div className="flex-1 bg-[var(--color-bg)] min-h-0">
        <PDFViewer
          width="100%"
          height="100%"
          showToolbar={false}
          style={{ border: "none" }}
        >
          <InvoicePDF
            invoice={sampleInvoice as never}
            lineItems={sampleLineItems}
            client={sampleClient as never}
            profile={sampleProfile as never}
            projectName={showProjectName ? "Brand Identity Project" : undefined}
            reminderCount={0}
            template={currentTemplateState as never}
          />
        </PDFViewer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FontFamily = "Helvetica" | "Times-Roman" | "Courier";
type LogoPosition = "left" | "center" | "right" | "hide";

function parseColumnOrder(raw: string | null | undefined): ColumnKey[] {
  if (!raw) return [...DEFAULT_COLUMN_ORDER];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ColumnKey[];
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_COLUMN_ORDER];
}
