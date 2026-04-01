import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  useBusinessProfile,
  useUpdateBusinessProfile,
} from "../db/hooks/useBusinessProfile";
import { parseActivities } from "../types/business-profile";
import type { BusinessProfile } from "../types/business-profile";
import { useT } from "../i18n/useT";
import type { UIKey } from "../i18n/ui";
import { Button, Input, PageSpinner } from "../components/ui";

type FormData = Omit<BusinessProfile, "id">;

type ProfileCategory = "business" | "bank" | "invoicing";

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
  const { data: profile, isLoading } = useBusinessProfile();
  const updateProfile = useUpdateBusinessProfile();
  const { register, handleSubmit, reset } = useForm<FormData>();
  const t = useT();

  const [activities, setActivities] = useState<string[]>([]);
  const [newActivity, setNewActivity] = useState("");
  const [activeCategory, setActiveCategory] = useState<ProfileCategory>("business");

  useEffect(() => {
    if (profile) {
      reset(profile);
      setActivities(parseActivities(profile.default_activity));
    }
  }, [profile, reset]);

  const onSubmit = (data: FormData) => {
    updateProfile.mutate(
      {
        ...data,
        default_activity: JSON.stringify(activities),
        vat_exempt: data.vat_exempt ? 1 : 0,
      },
      {
        onSuccess: () => toast.success(t.toast_profile_saved),
        onError: (err) => toast.error(`${t.failed_save_profile}: ${String(err)}`),
      }
    );
  };

  const saveActivities = (next: string[]) => {
    setActivities(next);
    updateProfile.mutate({ default_activity: JSON.stringify(next) });
  };

  const addActivity = () => {
    const val = newActivity.trim();
    if (!val) return;
    if (activities.includes(val)) {
      toast.error(t.activity_exists);
      return;
    }
    saveActivities([...activities, val]);
    setNewActivity("");
  };

  const removeActivity = (idx: number) => {
    saveActivities(activities.filter((_, i) => i !== idx));
  };

  const categories: { key: ProfileCategory; label: string }[] = [
    { key: "business", label: t.business_profile },
    { key: "bank", label: t.bank_details },
    { key: "invoicing", label: t.invoice_defaults },
  ];

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

  if (isLoading) return <PageSpinner />;

  return (
    <div className="flex gap-0 h-full -m-8">
      {/* Category sidebar */}
      <div className="w-56 shrink-0 border-r border-[var(--color-border-divider)] py-6">
        <h1 className="text-xl font-semibold px-6 mb-6">{t.profile}</h1>
        <nav className="space-y-0.5 px-3">
          {categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                activeCategory === cat.key
                  ? "bg-accent-light text-accent font-medium"
                  : "text-muted hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text)]"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-8">
          {activeCategory === "business" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.business_profile}
              </h2>
              <div className="grid grid-cols-2 gap-4 max-w-lg">
                {profileFields.map(({ key, labelKey, type }) => (
                  <div key={key} className={key === "address" ? "col-span-2" : ""}>
                    <label className="block text-xs font-medium text-muted mb-1">
                      {t[labelKey]}
                    </label>
                    <Input {...register(key)} type={type ?? "text"} />
                  </div>
                ))}
              </div>
              <Button type="submit" className="mt-6" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? t.saving : t.save}
              </Button>
            </section>
          )}

          {activeCategory === "bank" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.bank_details}
              </h2>
              <div className="grid grid-cols-2 gap-4 max-w-lg">
                {bankFields.map(({ key, labelKey }) => (
                  <div key={key} className={key === "bank_address" || key === "iban" || key === "qr_iban" ? "col-span-2" : ""}>
                    <label className="block text-xs font-medium text-muted mb-1">
                      {t[labelKey]}
                    </label>
                    <Input {...register(key)} type="text" />
                  </div>
                ))}
              </div>
              <Button type="submit" className="mt-6" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? t.saving : t.save}
              </Button>
            </section>
          )}

          {activeCategory === "invoicing" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.invoice_defaults}
              </h2>
              <div className="space-y-4 max-w-lg">
                {/* Activities list */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.activities}
                  </label>
                  <div className="space-y-1.5 mb-2">
                    {activities.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 border border-[var(--color-border-divider)] rounded-lg px-3 py-1.5 text-sm"
                      >
                        <span className="flex-1">{a}</span>
                        <button
                          type="button"
                          onClick={() => removeActivity(i)}
                          className="text-muted hover:text-[var(--color-danger-text)]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newActivity}
                      onChange={(e) => setNewActivity(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addActivity();
                        }
                      }}
                      placeholder={t.add_activity}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={addActivity}
                      className="p-2 text-muted hover:text-accent"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* Payment terms */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.payment_terms_days}
                  </label>
                  <Input
                    {...register("default_payment_terms_days", { valueAsNumber: true })}
                    type="number"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    {...register("vat_exempt")}
                    className="rounded"
                  />
                  <label className="text-sm">{t.vat_exempt}</label>
                </div>
              </div>
              <Button type="submit" className="mt-6" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? t.saving : t.save}
              </Button>
            </section>
          )}
        </form>
      </div>
    </div>
  );
}
