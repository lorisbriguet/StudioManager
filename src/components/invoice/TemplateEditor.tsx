import { useState, useCallback, useRef, useEffect } from "react";
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
  client_id: 0,
  contact_id: null,
  billing_address_id: null,
  language: "EN" as const,
  discount_rate: 0,
  discount_amount: 0,
  exchange_rate: null,
  chf_equivalent: null,
  chf_manual_override: null,
  pdf_path: null,
  payment_terms_days: 30,
  reminder_count: 0,
  last_reminder_date: null,
  template_id: null,
  created_at: "",
  updated_at: "",
};

const sampleLineItems = [
  { id: 1, invoice_id: 0, designation: "Logo Design", quantity: 1, rate: 1500, unit: "flat rate", amount: 1500, sort_order: 0 },
  { id: 2, invoice_id: 0, designation: "Brand Guidelines", quantity: 8, rate: 150, unit: "hours", amount: 1200, sort_order: 1 },
  { id: 3, invoice_id: 0, designation: "Business Card Design", quantity: 1, rate: 800, unit: "flat rate", amount: 800, sort_order: 2 },
];

const sampleClient = {
  id: 0,
  name: "Acme Corp",
  address: "123 Business St",
  postal_code: "8001",
  city: "Zurich",
  country: "Switzerland",
  email: "hello@acme.ch",
  language: "en" as const,
  phone: "",
  discount_rate: 0,
  notes: "",
  created_at: "",
  updated_at: "",
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
// Column order helpers
// ---------------------------------------------------------------------------

type ColumnKey = "designation" | "rate" | "unit" | "qty" | "amount";

const DEFAULT_COLUMN_ORDER: ColumnKey[] = ["designation", "rate", "unit", "qty", "amount"];

type ColumnLabels = Record<ColumnKey, string>;

function makeColumnLabels(t: { designation: string; rate: string; unit: string; qty: string; amount: string }): ColumnLabels {
  return {
    designation: t.designation,
    rate: t.rate,
    unit: t.unit,
    qty: t.qty,
    amount: t.amount,
  };
}

function parseColumnOrder(json: string | undefined): ColumnKey[] {
  try {
    const arr = JSON.parse(json ?? "[]");
    return Array.isArray(arr) ? arr : [...DEFAULT_COLUMN_ORDER];
  } catch {
    return [...DEFAULT_COLUMN_ORDER];
  }
}

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

type FontFamily = "Helvetica" | "Times-Roman" | "Courier";
type LogoPosition = "left" | "center" | "right" | "hide";

interface TemplateEditorProps {
  template?: InvoiceTemplate | null;
  onSaved?: (template: InvoiceTemplate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateEditor({ template, onSaved }: TemplateEditorProps) {
  const t = useT();
  const columnLabels = makeColumnLabels(t);
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

  // Measure right panel for PDFViewer pixel dimensions
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [panelSize, setPanelSize] = useState({ w: 600, h: 800 });
  useEffect(() => {
    const el = rightPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setPanelSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      toast.error(t.toast_name_required);
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
    <div className="flex h-full min-h-0">
      {/* Left panel: settings */}
      <div className="w-[340px] shrink-0 border-r border-[var(--color-border-divider)] overflow-y-auto p-6 space-y-5 bg-[var(--color-surface)]">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t.template_editor}
        </h2>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">{t.name}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.new_invoice_template} />
        </div>

        {/* Accent color */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">{t.invoice_template_accent_color}</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-[var(--color-border-divider)] bg-[var(--color-input-bg)] p-0.5"
            />
            <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-28 font-mono text-xs" />
          </div>
        </div>

        {/* Font family */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">{t.font_family}</label>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value as FontFamily)}
            className="w-full border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)]"
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
                <input type="radio" name="logo_position" value={pos} checked={logoPosition === pos} onChange={() => setLogoPosition(pos)} className="accent-accent" />
                <span className="capitalize">{pos}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Margins */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">{t.margins}</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { label: t.margin_top ?? "Top", value: marginTop, set: setMarginTop },
              { label: t.margin_right ?? "Right", value: marginRight, set: setMarginRight },
              { label: t.margin_bottom ?? "Bottom", value: marginBottom, set: setMarginBottom },
              { label: t.margin_left ?? "Left", value: marginLeft, set: setMarginLeft },
            ] as { label: string; value: number; set: (v: number) => void }[]).map(({ label, value, set }) => (
              <div key={label}>
                <label className="block text-xs text-muted mb-0.5">{label}</label>
                <Input type="number" value={value} onChange={(e) => set(Number(e.target.value))} className="text-right" />
              </div>
            ))}
          </div>
        </div>

        {/* Field visibility toggles */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">{t.visibility}</label>
          <div className="space-y-2">
            {([
              { label: t.show_notes, value: showNotes, set: setShowNotes },
              { label: t.show_project_name, value: showProjectName, set: setShowProjectName },
              { label: t.show_po_number, value: showPoNumber, set: setShowPoNumber },
              { label: t.show_bank_details, value: showBankDetails, set: setShowBankDetails },
              { label: t.show_qr_bill, value: showQrBill, set: setShowQrBill },
              { label: t.show_footer, value: showFooter, set: setShowFooter },
            ] as const).map(({ label, value, set }) => (
              <label key={label} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={value} onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} className="accent-accent rounded" />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Column order */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">{t.column_order}</label>
          <div className="space-y-1">
            {columnOrder.map((col, idx) => (
              <div key={col} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border-divider)] bg-[var(--color-bg)] text-sm">
                <span className="flex-1">{columnLabels[col]}</span>
                <button type="button" onClick={() => moveColumn(idx, -1)} disabled={idx === 0} className="text-muted hover:text-[var(--color-text)] disabled:opacity-30" aria-label="Move up">
                  <ChevronUp size={14} />
                </button>
                <button type="button" onClick={() => moveColumn(idx, 1)} disabled={idx === columnOrder.length - 1} className="text-muted hover:text-[var(--color-text)] disabled:opacity-30" aria-label="Move down">
                  <ChevronDown size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 pb-4">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? t.saving : t.save}
          </Button>
          {template?.id && !template.is_default && (
            <Button variant="secondary" onClick={handleSetDefault} disabled={setDefault.isPending}>
              {t.set_as_default}
            </Button>
          )}
        </div>
      </div>

      {/* Right panel: live PDF preview */}
      <div ref={rightPanelRef} className="flex-1 min-h-0 min-w-0 bg-[var(--color-bg)]">
        {panelSize.w > 100 && panelSize.h > 100 && (
          <PDFViewer
            width={panelSize.w}
            height={panelSize.h}
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
        )}
      </div>
    </div>
  );
}
