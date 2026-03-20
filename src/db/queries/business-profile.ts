import { getDb, validateFields } from "../index";
import type { BusinessProfile } from "../../types/business-profile";

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const db = await getDb();
  const rows = await db.select<BusinessProfile[]>(
    "SELECT * FROM business_profile WHERE id = 1"
  );
  return rows[0] ?? {
    id: 1,
    owner_name: "",
    address: "",
    postal_code: "",
    city: "",
    country: "",
    email: "",
    phone: "",
    ide_number: "",
    affiliate_number: "",
    bank_name: "",
    bank_address: "",
    iban: "",
    clearing: "",
    bic_swift: "",
    default_activity: "[]",
    vat_exempt: 0,
    default_payment_terms_days: 30,
  } as BusinessProfile;
}

export async function updateBusinessProfile(
  data: Partial<Omit<BusinessProfile, "id">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
  const values = fields.map((f) => data[f as keyof typeof data]);
  await db.execute(`UPDATE business_profile SET ${sets} WHERE id = 1`, values);
}
