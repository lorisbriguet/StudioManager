import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  useBusinessProfile,
  useUpdateBusinessProfile,
} from "../db/hooks/useBusinessProfile";
import type { BusinessProfile } from "../types/business-profile";
import { useT } from "../i18n/useT";
import type { UIKey } from "../i18n/ui";

type FormData = Omit<BusinessProfile, "id">;

const fields: { key: keyof FormData; labelKey: UIKey; type?: string }[] = [
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

const invoiceFields: { key: keyof FormData; labelKey: UIKey; type?: string }[] = [
  { key: "default_activity", labelKey: "default_activity" },
  { key: "default_payment_terms_days", labelKey: "payment_terms_days", type: "number" },
];

export function ProfilePage() {
  const { data: profile, isLoading } = useBusinessProfile();
  const updateProfile = useUpdateBusinessProfile();
  const { register, handleSubmit, reset } = useForm<FormData>();
  const t = useT();

  useEffect(() => {
    if (profile) {
      reset(profile);
    }
  }, [profile, reset]);

  const onSubmit = (data: FormData) => {
    updateProfile.mutate(data, {
      onSuccess: () => toast.success(t.toast_profile_saved),
      onError: () => toast.error(t.failed_save_profile),
    });
  };

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-10">
      <h1 className="text-xl font-semibold">{t.profile}</h1>

      {/* Business Profile */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
          {t.business_profile}
        </h2>
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          {fields.map(({ key, labelKey, type }) => (
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
      </section>

      {/* Bank Details */}
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
      </section>

      {/* Invoice Defaults */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
          {t.invoice_defaults}
        </h2>
        <div className="space-y-4 max-w-lg">
          {invoiceFields.map(({ key, labelKey, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted mb-1">
                {t[labelKey]}
              </label>
              <input
                {...register(key, { valueAsNumber: type === "number" })}
                type={type ?? "text"}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register("vat_exempt")}
              className="rounded"
            />
            <label className="text-sm">{t.vat_exempt}</label>
          </div>
        </div>
      </section>

      <button
        type="submit"
        disabled={updateProfile.isPending}
        className="px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50"
      >
        {updateProfile.isPending ? t.saving : t.save}
      </button>
    </form>
  );
}
