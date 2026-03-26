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
  created_at: string;
  updated_at: string;
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
