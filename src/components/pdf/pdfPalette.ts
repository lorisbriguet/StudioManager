/**
 * The one colour palette for generated PDFs (invoices, quotes, finance
 * reports). PDFs print on white and never follow the app theme or dark
 * mode, so these are literal values, not CSS variables. A template's own
 * accent colour (InvoiceTemplate.accent_color) still overrides `ink` where
 * documentStyles applies it.
 */
export const PDF = {
  /** Body text, headings, strong rules (table header, totals) */
  ink: "#1a1a1a",
  /** Secondary text (addresses, notes) */
  textSecondary: "#444",
  /** Labels, column headers, meta lines */
  muted: "#666",
  /** Footers, page numbers, fine print */
  faint: "#999",
  /** Row dividers */
  rule: "#ddd",
  /** Lighter row dividers in list reports */
  ruleLight: "#e5e5e5",
  /** Alternate row / subtotal fill */
  stripe: "#f8f8f8",
  /** Status text in list reports */
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  neutral: "#6b7280",
  /** Overdue / warning box on a document */
  dangerBg: "#fee2e2",
  dangerText: "#b91c1c",
} as const;
