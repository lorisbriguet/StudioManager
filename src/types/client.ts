export interface Client {
  id: string;
  name: string;
  billing_name: string;
  address_line1: string;
  address_line2: string;
  postal_city: string;
  email: string;
  phone: string;
  language: "FR" | "EN";
  has_discount: number;
  discount_rate: number;
  notes: string;
  /** Set when archived: hidden from lists and pickers, kept with its invoices. */
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Clients a picker offers: archived ones are left out, except the one
 * already selected (an older invoice or project keeps showing its client).
 */
export function pickableClients<C extends Pick<Client, "id" | "archived_at">>(
  clients: C[] | undefined,
  selectedId?: string | null
): C[] {
  return (clients ?? []).filter((c) => !c.archived_at || c.id === selectedId);
}

export interface ClientAddress {
  id: number;
  client_id: string;
  label: string;
  billing_name: string;
  address_line1: string;
  address_line2: string;
  postal_city: string;
}

export interface ClientContact {
  id: number;
  client_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: string;
}
