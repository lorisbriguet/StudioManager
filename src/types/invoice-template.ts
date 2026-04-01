export interface InvoiceTemplate {
  id: number;
  name: string;
  is_default: number;
  accent_color: string;
  font_family: string;
  logo_position: "left" | "center" | "right" | "hide";
  margins_top: number;
  margins_right: number;
  margins_bottom: number;
  margins_left: number;
  show_notes: number;
  show_project_name: number;
  show_po_number: number;
  show_bank_details: number;
  show_qr_bill: number;
  show_footer: number;
  columns: string; // JSON array
  created_at: string;
  updated_at: string;
}
