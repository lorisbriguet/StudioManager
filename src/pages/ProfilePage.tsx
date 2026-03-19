import { useEffect, useState } from "react";
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

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  const categories: { key: ProfileCategory; label: string }[] = [
    { key: "business", label: t.business_profile },
    { key: "bank", label: t.bank_details },
    { key: "invoicing", label: t.invoice_defaults },
  ];

  return (
    <div className="flex gap-0 h-full -m-8">
      {/* Category sidebar */}
      <div className="w-56 shrink-0 border-r border-gray-200 py-6">
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
                  : "text-muted hover:bg-gray-100 hover:text-gray-900"
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
                    <input
                      {...register(key)}
                      type={type ?? "text"}
                      className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                ))}
              </div>
              <button
                type="submit"
                disabled={updateProfile.isPending}
                className="mt-6 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50"
              >
                {updateProfile.isPending ? t.saving : t.save}
              </button>
            </section>
          )}

          {activeCategory === "bank" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.bank_details}
              </h2>
              <div className="grid grid-cols-2 gap-4 max-w-lg">
                {bankFields.map(({ key, labelKey }) => (
                  <div key={key} className={key === "bank_address" || key === "iban" ? "col-span-2" : ""}>
                    <label className="block text-xs font-medium text-muted mb-1">
                      {t[labelKey]}
                    </label>
                    <input
                      {...register(key)}
                      type="text"
                      className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                ))}
              </div>
              <button
                type="submit"
                disabled={updateProfile.isPending}
                className="mt-6 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50"
              >
                {updateProfile.isPending ? t.saving : t.save}
              </button>
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
                        className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
                      >
                        <span className="flex-1">{a}</span>
                        <button
                          type="button"
                          onClick={() => removeActivity(i)}
                          className="text-muted hover:text-red-600"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newActivity}
                      onChange={(e) => setNewActivity(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addActivity();
                        }
                      }}
                      placeholder={t.add_activity}
                      className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
                  <input
                    {...register("default_payment_terms_days", { valueAsNumber: true })}
                    type="number"
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
              <button
                type="submit"
                disabled={updateProfile.isPending}
                className="mt-6 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50"
              >
                {updateProfile.isPending ? t.saving : t.save}
              </button>
            </section>
          )}
        </form>
      </div>
    </div>
  );
}
