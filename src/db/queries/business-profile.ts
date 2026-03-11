import { getDb, validateFields } from "../index";
import type { BusinessProfile } from "../../types/business-profile";

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const db = await getDb();
  const rows = await db.select<BusinessProfile[]>(
    "SELECT * FROM business_profile WHERE id = 1"
  );
  return rows[0];
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
