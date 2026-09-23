// Stub for Task 17 — replaced there with the actual "create organisation" dialog.
// Kept here so Task 16 (sidebar switcher) can wire up the "New organisation"
// action without waiting on that task.
export function OrgCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  void open;
  void onClose;
  return null;
}
