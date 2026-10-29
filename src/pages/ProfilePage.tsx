import { useEffect, useState, useCallback, useMemo } from "react";
import { IconButton } from "../components/ui/IconButton";
import { useForm } from "react-hook-form";
import { Landmark, type LucideIcon } from "lucide-react";
import { ICONS, ICON_SIZE } from "../components/ui/icons";
import { isUntranslatedActivity } from "../lib/activityNudge";
import { notify } from "../lib/notify";
import { deleteWithUndo } from "../lib/undo";
import {
  useBusinessProfile,
  useUpdateBusinessProfile,
} from "../db/hooks/useBusinessProfile";
import type { BusinessProfile } from "../types/business-profile";
import { useActivities, useCreateActivity, useUpdateActivity, useDeleteActivity } from "../db/hooks/useActivities";
import type { Activity } from "../types/activity";
import { useT } from "../i18n/useT";
import type { UIKey } from "../i18n/ui";
import { Button, FormField, FormLayout, FormSection, FormGrid, FormGroup, FormActions, Input, DetailSkeleton, EmptyState, QueryError, SectionLabel, SidebarTitle, FORM_GAP, FORM_WIDTH, FIELD_LABEL } from "../components/ui";
import { Toggle } from "../components/ui/Toggle";
import { TemplateEditor } from "../components/invoice/TemplateEditor";
import {
  useInvoiceTemplates,
  useDeleteInvoiceTemplate,
} from "../db/hooks/useInvoiceTemplates";
import type { InvoiceTemplate } from "../types/invoice-template";
import { NavItem } from "../components/ui/NavItem";

type FormData = Omit<BusinessProfile, "id">;

type ProfileCategory = "business" | "bank" | "invoicing" | "templates";

const profileFields: { key: keyof FormData; labelKey: UIKey; type?: string }[] = [
  { key: "owner_name", labelKey: "owner_name" },
  { key: "address", labelKey: "address" },
  { key: "postal_code", labelKey: "postal_code" },
  { key: "city", labelKey: "city" },
  { key: "country", labelKey: "country" },
  { key: "email", labelKey: "email", type: "email" },
  { key: "phone", labelKey: "phone" },
  { key: "ide_number", labelKey: "ide_number" },
  { key: "affiliate_number", labelKey: "affiliate_number" },
];

const bankFields: { key: keyof FormData; labelKey: UIKey }[] = [
  { key: "bank_name", labelKey: "bank_name" },
  { key: "bank_address", labelKey: "bank_address" },
  { key: "iban", labelKey: "iban" },
  { key: "qr_iban", labelKey: "qr_iban" },
  { key: "clearing", labelKey: "clearing" },
  { key: "bic_swift", labelKey: "bic_swift" },
];

export function ProfilePage() {
  const { data: profile, isLoading, isError: profileError, isFetching: profileFetching, refetch: refetchProfile } = useBusinessProfile();
  const updateProfile = useUpdateBusinessProfile();
  // Phase 2 E3: this stays a react-hook-form form — FormField is wired
  // presentationally around register (label/id association, error passthrough).
  // No required marks: the save path enforces no field, so none would be honest.
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors: rhfErrors },
  } = useForm<FormData>();
  const t = useT();

  const { data: activityList } = useActivities();
  const createActivityMut = useCreateActivity();
  const updateActivityMut = useUpdateActivity();
  const deleteActivityMut = useDeleteActivity();
  const [newFr, setNewFr] = useState("");
  const [newEn, setNewEn] = useState("");

  const addNewActivity = () => {
    if (!newFr.trim() && !newEn.trim()) return;
    createActivityMut.mutate(
      { name_fr: newFr, name_en: newEn },
      { onSuccess: () => { setNewFr(""); setNewEn(""); } }
    );
  };
  const [activeCategory, setActiveCategory] = useState<ProfileCategory>("business");

  // Templates state
  const { data: invoiceTemplates } = useInvoiceTemplates();
  const deleteTemplate = useDeleteInvoiceTemplate();
  const [editingTemplate, setEditingTemplate] = useState<InvoiceTemplate | null | "new">(null);

  useEffect(() => {
    if (profile) {
      reset(profile);
    }
  }, [profile, reset]);

  const onSubmit = (data: FormData) => {
    updateProfile.mutate(
      {
        ...data,
        vat_exempt: data.vat_exempt ? 1 : 0,
      },
      {
        onSuccess: () => notify.success(t.toast_profile_saved),
      }
    );
  };

  const categories = useMemo<Array<{ key: ProfileCategory; label: string; icon: LucideIcon }>>(() => [
    { key: "business", label: t.business_profile, icon: ICONS.organisation },
    { key: "bank", label: t.bank_details, icon: Landmark },
    { key: "invoicing", label: t.invoice_defaults, icon: ICONS.invoice },
    { key: "templates", label: t.templates, icon: ICONS.invoiceTemplates },
  ], [t]);

  // Keyboard navigation for profile sidebar
  const handleProfileKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = categories.findIndex((c) => c.key === activeCategory);
        const len = categories.length;
        const next = e.key === "ArrowDown" ? (idx + 1) % len : (idx - 1 + len) % len;
        setActiveCategory(categories[next].key);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sidebar-focus"));
      }
    },
    [activeCategory, categories]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleProfileKeyDown);
    return () => window.removeEventListener("keydown", handleProfileKeyDown);
  }, [handleProfileKeyDown]);

  if (isLoading) return <DetailSkeleton blocks={4} />;
  if (profileError && profile === undefined) return <QueryError message={t.load_error_profile} onRetry={refetchProfile} retrying={profileFetching} />;

  return (
    <div className="flex gap-0 -m-8" style={{ height: "calc(100vh - 80px)" }}>
      {/* Category sidebar */}
      <div className="w-56 shrink-0 border-r border-[var(--color-border-divider)] py-6">
        <SidebarTitle className="px-6 mb-6">{t.profile}</SidebarTitle>
        <nav aria-label={t.profile} className="space-y-0.5 px-3">
          {categories.map((cat) => (
            <NavItem
              key={cat.key}
              size="md"
              active={activeCategory === cat.key}
              icon={cat.icon}
              onClick={() => {
                setActiveCategory(cat.key);
                setEditingTemplate(null);
              }}
            >
              {cat.label}
            </NavItem>
          ))}
        </nav>
      </div>

      {/* Content */}
      {activeCategory === "templates" ? (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {editingTemplate !== null ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <TemplateEditor
                template={editingTemplate === "new" ? null : editingTemplate}
                onSaved={() => setEditingTemplate(null)}
              />
            </div>
          ) : (
            <div className="p-8">
              <SectionLabel
                as="h2"
                className={`mb-3 ${FORM_WIDTH}`}
                action={
                  <Button
                    variant="secondary"
                    icon={ICONS.add}
                    onClick={() => setEditingTemplate("new")}
                  >
                    {t.new_invoice_template}
                  </Button>
                }
              >
                {t.templates}
              </SectionLabel>
              <div className={`space-y-1.5 ${FORM_WIDTH}`}>
                {invoiceTemplates && invoiceTemplates.length > 0 ? (
                  invoiceTemplates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className="flex items-center gap-2 border border-[var(--color-border-divider)] rounded-lg px-3 py-2"
                    >
                      <button
                        type="button"
                        className="flex-1 text-left text-sm hover:text-accent-text"
                        onClick={() => setEditingTemplate(tmpl)}
                      >
                        <span>{tmpl.name}</span>
                        {!!tmpl.is_default && (
                          <span className="ml-2 text-xs text-muted">({t.template_default_badge})</span>
                        )}
                      </button>
                      <IconButton size="xs"
                        icon={ICONS.delete}
                        label={t.delete_template}
                        tone="danger"
                        disabled={!!tmpl.is_default}
                        onClick={() => deleteWithUndo(deleteTemplate, tmpl.id, t.invoice_template_deleted)}
                      />
                    </div>
                  ))
                ) : (
                  <EmptyState size="sm" message={t.no_invoice_templates} />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-8">
        <FormLayout as="form" onSubmit={handleSubmit(onSubmit)}>
          {activeCategory === "business" && (
            <FormSection title={t.business_profile}>
              <FormGrid cols={2}>
                {profileFields.map(({ key, labelKey, type }) => (
                  <FormField
                    key={key}
                    label={t[labelKey]}
                    error={rhfErrors[key]?.message}
                    span={key === "address" ? "full" : undefined}
                  >
                    <Input {...register(key)} type={type ?? "text"} />
                  </FormField>
                ))}
              </FormGrid>
            </FormSection>
          )}

          {activeCategory === "bank" && (
            <FormSection title={t.bank_details}>
              <FormGrid cols={2}>
                {bankFields.map(({ key, labelKey }) => (
                  <FormField
                    key={key}
                    label={t[labelKey]}
                    error={rhfErrors[key]?.message}
                    span={key === "bank_address" || key === "iban" || key === "qr_iban" ? "full" : undefined}
                  >
                    <Input {...register(key)} type="text" />
                  </FormField>
                ))}
              </FormGrid>
            </FormSection>
          )}

          {activeCategory === "invoicing" && (
            <FormSection title={t.invoice_defaults}>
              <FormGrid cols={1}>
                {/* Activities list */}
                <FormGroup label={t.activities}>
                  <div className={`grid grid-cols-[1fr_1fr_auto] ${FORM_GAP} items-center mb-1`}>
                    <span className={FIELD_LABEL}>{t.activity_name_fr}</span>
                    <span className={FIELD_LABEL}>{t.activity_name_en}</span>
                    <span className="w-[14px]" />
                  </div>
                  <div className="space-y-1.5 mb-2">
                    {(activityList ?? []).map((a) => (
                      <ActivityRow
                        key={a.id}
                        activity={a}
                        onSave={(name_fr, name_en) => updateActivityMut.mutate({ id: a.id, name_fr, name_en })}
                        onDelete={() => deleteWithUndo(deleteActivityMut, a.id, t.activity_deleted)}
                        removeLabel={t.remove}
                      />
                    ))}
                  </div>
                  <div className={`grid grid-cols-[1fr_1fr_auto] ${FORM_GAP} items-center`}>
                    <Input
                      value={newFr}
                      onChange={(e) => setNewFr(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewActivity(); } }}
                      placeholder={t.activity_name_fr}
                      aria-label={t.activity_name_fr}
                    />
                    <Input
                      value={newEn}
                      onChange={(e) => setNewEn(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewActivity(); } }}
                      placeholder={t.activity_name_en}
                      aria-label={t.activity_name_en}
                    />
                    <IconButton icon={ICONS.add} label={t.add_activity} tone="accent" onClick={addNewActivity} />
                  </div>
                </FormGroup>

                {/* Payment terms */}
                <FormGrid cols={2}>
                  <FormField
                    label={t.payment_terms_days}
                    error={rhfErrors.default_payment_terms_days?.message}
                  >
                    <Input
                      {...register("default_payment_terms_days", { valueAsNumber: true })}
                      numeric
                    />
                  </FormField>
                </FormGrid>

                <div>
                  <Toggle
                    checked={!!watch("vat_exempt")}
                    onChange={(v) => setValue("vat_exempt", v ? 1 : 0)}
                    label={t.vat_exempt}
                  />
                </div>
              </FormGrid>
            </FormSection>
          )}

          <FormActions>
            <Button type="submit" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? t.saving : t.save}
            </Button>
          </FormActions>
        </FormLayout>
      </div>
      )}
    </div>
  );
}

export function ActivityRow({
  activity,
  onSave,
  onDelete,
  removeLabel,
}: {
  activity: Activity;
  onSave: (name_fr: string, name_en: string) => void;
  onDelete: () => void;
  removeLabel: string;
}) {
  const t = useT();
  const [fr, setFr] = useState(activity.name_fr);
  const [en, setEn] = useState(activity.name_en);
  useEffect(() => {
    setFr(activity.name_fr);
    setEn(activity.name_en);
  }, [activity.name_fr, activity.name_en]);

  const commit = () => {
    if (fr.trim() === activity.name_fr && en.trim() === activity.name_en) return;
    onSave(fr, en);
  };

  // Live on the local edit state: translating clears the nudge immediately
  const untranslated = isUntranslatedActivity({ name_fr: fr, name_en: en });

  return (
    <div className={`grid grid-cols-[1fr_1fr_auto] ${FORM_GAP} items-center`}>
      <Input value={fr} onChange={(e) => setFr(e.target.value)} onBlur={commit} aria-label={t.activity_name_fr} />
      <Input value={en} onChange={(e) => setEn(e.target.value)} onBlur={commit} aria-label={t.activity_name_en} />
      <div className="flex items-center gap-1">
        {untranslated && (
          <span
            title={t.activity_untranslated}
            aria-label={t.activity_untranslated}
            className="text-[var(--color-warning-text)]"
          >
            <ICONS.warning size={ICON_SIZE.control} />
          </span>
        )}
        <IconButton icon={ICONS.close} label={removeLabel} tone="danger" onClick={onDelete} />
      </div>
    </div>
  );
}
