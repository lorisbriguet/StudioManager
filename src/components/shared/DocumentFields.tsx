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
}: {
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
            type="number"
            value={rate || ""}
            onChange={(e) => onRateChange(e.target.value ? Number(e.target.value) : 0)}
            placeholder={t.global_rate}
            fullWidth={false}
            className="w-28 text-right"
          />
          <Select value={unit} onChange={(e) => onUnitChange(e.target.value)} fullWidth={false}>
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
