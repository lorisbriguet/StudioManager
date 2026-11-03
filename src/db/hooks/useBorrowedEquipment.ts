import { equipmentOrgId } from "..";
import { useOrgStore } from "../../stores/org-store";

/**
 * True while this organisation uses another one's machines (prefs.equipmentFrom).
 * Borrowers skip connection syncs and their own connections do not apply to the
 * lender's machines, so screens show the lender's state and hide what would change it.
 */
export function useBorrowedEquipment(): boolean {
  // Subscribe to the pref so the screen follows a change; equipmentOrgId() applies the full rule.
  useOrgStore((s) => s.activePrefs()?.equipmentFrom ?? "");
  return equipmentOrgId() !== null;
}
