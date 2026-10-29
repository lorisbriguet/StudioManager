import { Checkbox, FormField, Input, Select } from "../ui";
import { FORM_GAP } from "../ui/tokens";
import { useT } from "../../i18n/useT";
import type { InvoiceTemplate } from "../../types/invoice-template";

/**
 * Fields shared by the invoice and quote forms. They only draw: each form
 * passes its own callbacks (dirty marking, re-pricing the line items…).
 */

/** The invoice-template picker: None, then every template, the default one marked. */
export function TemplateField({
  templates,
  value,
  onChange,
}: {
  templates: Pick<InvoiceTemplate, "id" | "name" | "is_default">[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const t = useT();
  return (
    <FormField label={t.select_invoice_template}>
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{t.none}</option>
        {templates.map((tmpl) => (
          <option key={tmpl.id} value={tmpl.id}>
            {tmpl.name}{tmpl.is_default ? ` ${t.default_suffix}` : ""}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/**
 * "Apply a global rate": the checkbox, then (when on) the rate and its unit.
 * The checkbox and rate fire native change events, so a parent listening for
 * them (dirty tracking) still hears them; the unit Select does not.
 */
export function GlobalRateControl({
  enabled,
  rate,
  unit,
  onEnabledChange,
  onRateChange,
  onUnitChange,
  currency = "CHF",
}: {
  /** The document's currency, shown inside the rate field. */
  currency?: string;
  enabled: boolean;
  rate: number;
  unit: string;
  onEnabledChange: (enabled: boolean) => void;
  onRateChange: (rate: number) => void;
  onUnitChange: (unit: string) => void;
}) {
  const t = useT();
  return (
    <div className={`flex items-center ${FORM_GAP}`}>
      <Checkbox label={t.apply_global_rate} checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
      {enabled && (
        <>
          <Input
            numeric
            step="0.01"
            value={rate || ""}
            onChange={(e) => onRateChange(e.target.value ? Number(e.target.value) : 0)}
            placeholder={t.global_rate}
            aria-label={t.global_rate}
            unit={currency}
            width="md"
          />
          <Select value={unit} onChange={(e) => onUnitChange(e.target.value)} fullWidth={false} aria-label={t.unit}>
            <option value="hours">{t.hours}</option>
            <option value="days">{t.days}</option>
            <option value="units">{t.units}</option>
            <option value="flat">{t.flat_rate}</option>
          </Select>
        </>
      )}
    </div>
  );
}
